// Customer booking status: secure emailed UUID+booking email, or request a private
// link using the friendly LYN reference and booking email. No appointment table RLS changes.
// Deploy as Supabase Edge Function 'booking-status' with Verify JWT OFF.
import { createClient } from "npm:@supabase/supabase-js@2";

const origin = "https://hair-by-lynna.pages.dev";
const headers = {
  "Content-Type":"application/json",
  "Cache-Control":"no-store",
  "Access-Control-Allow-Origin":origin,
  "Vary":"Origin"
};
const json = (data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers});
const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const referencePattern = /^LYN-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})-([0-9A-F]{4})$/i;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const safeHtml=(v:unknown)=>String(v??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
const referenceFor=(id:string,iso:string)=>{
  const parts=new Intl.DateTimeFormat("en-CA",{timeZone:"America/Toronto",
    year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"
  }).formatToParts(new Date(iso));
  const v=(key:string)=>parts.find(p=>p.type===key)?.value??"";
  return "LYN-"+v("year")+v("month")+v("day")+"-"+v("hour")+v("minute")+"-"+id.replace(/-/g,"").slice(0,4).toUpperCase();
};
const genericMessage="If the booking reference and email match, a secure status link will arrive shortly. Check your spam folder too.";

Deno.serve(async req=>{
  if(req.method==="OPTIONS")return new Response(null,{status:204,headers:{
    "Access-Control-Allow-Origin":origin,"Vary":"Origin",
    "Access-Control-Allow-Headers":"content-type,apikey,authorization,x-client-info,x-supabase-api-version",
    "Access-Control-Allow-Methods":"POST,OPTIONS","Access-Control-Max-Age":"3600"
  }});
  if(req.method!=="POST")return json({error:"Method not allowed"},405);
  let body:Record<string,unknown>;
  try{body=await req.json()}catch{return json({error:"Invalid request"},400)}
  const email=typeof body.email==="string"?body.email.trim().toLowerCase():"";
  if(email.length>254||!emailPattern.test(email))return json({error:"Enter a valid booking email."},400);
  const url=Deno.env.get("SUPABASE_URL");
  const key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!url||!key)return json({error:"Booking status service temporarily unavailable."},503);
  const db=createClient(url,key,{auth:{persistSession:false}});

  if(body.action==="send_link"){
    const reference=typeof body.reference==="string"?body.reference.trim().toUpperCase():"";
    const parsed=reference.match(referencePattern);
    if(!parsed)return json({error:"Enter a valid LYN booking reference."},400);
    const [,year,month,day,hour,minute]=parsed;
    const date=new Date(Date.UTC(Number(year),Number(month)-1,Number(day)));
    if(date.getUTCFullYear()!==Number(year)||date.getUTCMonth()+1!==Number(month)||
       date.getUTCDate()!==Number(day)||Number(hour)>23||Number(minute)>59)
      return json({error:"Enter a valid booking reference."},400);
    const brevoKey=Deno.env.get("BREVO_API_KEY"),sender=Deno.env.get("BOOKING_EMAIL_FROM");
    if(!brevoKey||!sender)return json({error:"Status-link email is not configured yet."},503);

    const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(email));
    const hash=Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,"0")).join("");
    const {data:permitted,error:throttleError}=await db.rpc("booking_status_allow_link_request",{p_key:hash});
    if(throttleError){console.error("booking-status: rate limiter not ready",throttleError.code);return json({error:"Status-link email is temporarily unavailable."},503)}
    // Do not tell a caller whether the booking exists or if they hit a private rate limit.
    if(!permitted)return json({sent:true,message:genericMessage});

    // Query only a narrow date range, and compare the full LYN reference and email server-side.
    const start=new Date(Date.UTC(Number(year),Number(month)-1,Number(day)-1)).toISOString();
    const end=new Date(Date.UTC(Number(year),Number(month)-1,Number(day)+2)).toISOString();
    const {data:matches,error:lookupError}=await db.from("appointments")
      .select("id,customer_email,starts_at")
      .gte("starts_at",start).lt("starts_at",end).limit(500);
    if(lookupError){console.error("booking-status: reference lookup failed",lookupError.code);return json({error:"Status-link email temporarily unavailable."},503)}
    const match=(matches||[]).find(a=>a.customer_email?.trim().toLowerCase()===email&&referenceFor(a.id,a.starts_at)===reference);
    if(match){
      const link=origin+"/?booking="+encodeURIComponent(match.id)+"&ref="+encodeURIComponent(reference)+"#booking-status";
      const text="Hair by Lynna — Booking status\n\nYour reference: "+reference+
        "\nOpen your private status link: "+link+
        "\n\nEnter the same booking email to view the appointment. Keep this link private.";
      const html='<html><body style="font-family:Arial,sans-serif;background:#120c13;color:#f9e8f2;padding:28px;">'+
        '<div style="max-width:480px;margin:auto;background:#261421;border:1px solid #c888a7;border-radius:12px;padding:28px;">'+
        '<img src="https://hair-by-lynna.pages.dev/images/hair-by-lynna-logo.png" alt="Hair by Lynna" width="260" style="display:block;width:260px;max-width:100%;height:auto;margin:0 auto 22px;border:0;outline:none;text-decoration:none;" /><p>Your booking reference:</p><h2 style="color:#ffd7e9;">'+safeHtml(reference)+'</h2>'+
        '<a style="display:inline-block;padding:14px 21px;background:#dda0bc;border-radius:7px;color:#1b0d16;text-decoration:none;font-weight:bold;" href="'+safeHtml(link)+'">Check booking status</a>'+
        '<p style="font-size:13px;">Enter your booking email to check your appointment. Keep this link private.</p></div></body></html>';
      try{
        const mail=await fetch("https://api.brevo.com/v3/smtp/email",{
          method:"POST",headers:{"Content-Type":"application/json","api-key":brevoKey,"accept":"application/json"},
          body:JSON.stringify({sender:{email:sender,name:"Hair by Lynna"},replyTo:{email:"xhair.dreams@gmail.com",name:"Lynna"},
            to:[{email}],subject:"Hair by Lynna — Your private booking status link",textContent:text,htmlContent:html})
        });
        if(!mail.ok)console.error("booking-status: Brevo failed",mail.status);
      }catch(e){console.error("booking-status: status link email network failure",String(e))}
    }
    return json({sent:true,message:genericMessage});
  }

  const action=body.action??"check";
  if(action!=="check"&&action!=="respond_reschedule"&&action!=="report_deposit_sent")return json({error:"Invalid request"},400);
  const id=typeof body.id==="string"?body.id.trim():"";
  if(!idPattern.test(id))return json({error:"Open the private booking link from your email."},400);
  const fields="id,customer_email,starts_at,ends_at,status,services(name_en,name_fr),reschedule_response,reschedule_previous_starts_at,reschedule_previous_ends_at,reschedule_revision,deposit_amount_cents,deposit_received_at,deposit_due_at,deposit_reported_sent_at";
  const {data,error}=await db.from("appointments").select(fields).eq("id",id).maybeSingle();
  if(error){console.error("booking-status: appointment lookup failed",error.code);return json({error:"Booking status temporarily unavailable."},503)}
  if(!data||data.customer_email?.trim().toLowerCase()!==email)
    return json({error:"Booking not found. Check the email used when booking."},404);

  let appointment=data;
  if(action==="report_deposit_sent"){
    // Customer reports a transfer, not proof that money arrived. This service
    // role-only RPC never sets deposit_received_at. Repeated clicks are safe.
    if(data.deposit_received_at)return json({error:"Lynna has already confirmed this deposit."},409);
    if(!["pending","approved"].includes(data.status))
      return json({error:"This booking is no longer active."},409);
    const {data:reported,error:reportError}=await db.rpc("customer_report_deposit_sent",{
      p_appointment_id:id,p_booking_email:email
    });
    if(reportError){
      console.error("booking-status: report deposit failed",reportError.code);
      return json({error:"Unable to record the deposit report. Please try again."},503);
    }
    if(!reported)return json({error:"The booking has changed. Please check again."},409);
    // Read fresh status, including any simultaneous manual confirmation.
    const {data:updated,error:refreshError}=await db.from("appointments")
      .select(fields).eq("id",id).maybeSingle();
    if(refreshError||!updated)return json({error:"Please refresh your booking status."},503);
    appointment=updated;
  }
  if(action==="respond_reschedule"){
    const reply=body.response;
    const revision=body.revision;
    if(reply!=="confirmed"&&reply!=="needs_contact")return json({error:"Invalid response."},400);
    if(!Number.isSafeInteger(revision)||revision<1)return json({error:"Invalid proposal."},400);
    if(data.status!=="approved"||data.reschedule_response!=="pending"||data.reschedule_revision!==revision)
      return json({error:"That reschedule request has changed. Check the latest appointment information before responding."},409);
    // Conditional update prevents double responses and stale clicks after a newer reschedule.
    const {data:updated,error:updateError}=await db.from("appointments")
      .update({reschedule_response:reply})
      .eq("id",id).eq("status","approved")
      .eq("reschedule_response","pending")
      .eq("reschedule_revision",revision)
      .select(fields).maybeSingle();
    if(updateError){console.error("booking-status: reschedule response failed",updateError.code);return json({error:"Could not save your response. Please try again."},503)}
    if(!updated)return json({error:"Your appointment has changed. Please check its latest status."},409);
    appointment=updated;
  }

  const service=Array.isArray(appointment.services)?appointment.services[0]:appointment.services;
  return json({id:appointment.id,status:appointment.status,starts_at:appointment.starts_at,ends_at:appointment.ends_at,
    service_en:service?.name_en??"",service_fr:service?.name_fr??"",
    reschedule_response:appointment.reschedule_response,
    reschedule_previous_starts_at:appointment.reschedule_previous_starts_at,
    reschedule_previous_ends_at:appointment.reschedule_previous_ends_at,
    reschedule_revision:appointment.reschedule_revision,
    deposit_amount_cents:appointment.deposit_amount_cents,
    deposit_received_at:appointment.deposit_received_at,
    deposit_due_at:appointment.deposit_due_at,
    deposit_reported_sent_at:appointment.deposit_reported_sent_at});
});
