// Supabase Edge Function: telegram-booking
// Deploy via Supabase Dashboard > Edge Functions, with JWT verification OFF.
// Protected by X-Webhook-Secret (shared with Database Webhook), not callable openly.
import { createClient } from "npm:@supabase/supabase-js@2";

const token = Deno.env.get("TELEGRAM_BOT_TOKEN");
const chatId = Deno.env.get("TELEGRAM_CHAT_ID");
const secret = Deno.env.get("BOOKING_WEBHOOK_SECRET");
const supabaseUrl = Deno.env.get("SUPABASE_URL");
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const escapeHtml = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const monTime = (iso: string) => new Intl.DateTimeFormat("en-CA", {timeZone:"America/Toronto",dateStyle:"full",timeStyle:"short"}).format(new Date(iso));
function shortRef(id: string, iso: string) {
  const parts=new Intl.DateTimeFormat("en-CA",{timeZone:"America/Toronto",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(new Date(iso));
  const val=(part:string)=>parts.find(p=>p.type===part)?.value??"";
  return "LYN-"+val("year")+val("month")+val("day")+"-"+val("hour")+val("minute")+"-"+id.replace(/-/g,"").slice(0,4).toUpperCase();
}
Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed",{status:405});
  if (!token || !chatId || !secret || !supabaseUrl || !serviceKey) { console.error("telegram-booking configuration missing:",{botToken:!!token,chatId:!!chatId,webhookSecret:!!secret,supabaseUrl:!!supabaseUrl,serviceRoleKey:!!serviceKey}); return new Response("Not configured",{status:503}); }
  const provided=req.headers.get("x-webhook-secret");
  if (!provided || provided !== secret) { console.error("telegram-booking: webhook secret header absent or incorrect"); return new Response("Unauthorized",{status:401}); }
  let payload: {type?:string;table?:string;schema?:string;record?:Record<string,unknown>;old_record?:Record<string,unknown>};
  try {payload=await req.json()} catch {return new Response("Invalid JSON",{status:400})}
  if(payload.schema!=="public"||payload.table!=="appointments"){console.error("telegram-booking: unexpected webhook source",payload.schema,payload.table);return new Response("Ignored",{status:200});}
  const current=payload.record;
  if (!current || typeof current.id!=="string" || typeof current.starts_at!=="string" || typeof current.status!=="string")return new Response("Ignored",{status:200});
  const previous=payload.old_record||{};
  let heading="";
  if(payload.type==="INSERT" && current.status==="pending")heading="🆕 New appointment request";
  else if(payload.type==="UPDATE" && previous.status!==current.status){
    if(current.status==="approved")heading="✅ Appointment approved";
    else if(current.status==="declined")heading="❌ Appointment declined";
    else if(current.status==="cancelled")heading="🚫 Appointment cancelled";
  } else if(payload.type==="UPDATE" && (previous.starts_at!==current.starts_at || previous.ends_at!==current.ends_at)) heading="📅 Appointment rescheduled";
  if(!heading)return new Response("No notification needed",{status:200});
  const db=createClient(supabaseUrl,serviceKey,{auth:{persistSession:false}});
  const {data,error}=await db.from("appointments")
    .select("id,customer_name,customer_email,starts_at,ends_at,status,services(name_en)")
    .eq("id",current.id).single();
  if(error||!data){console.error("telegram-booking: appointment lookup failed",{code:error?.code,message:error?.message});return new Response("Appointment lookup failed",{status:500});}
  const serviceName=Array.isArray(data.services)?data.services[0]?.name_en:(data.services as {name_en?:string}|null)?.name_en;
  const lines=[
    heading,
    "",
    "Client: "+escapeHtml(data.customer_name),
    "Service: "+escapeHtml(serviceName??"Service"),
    "Starts: "+escapeHtml(monTime(data.starts_at)),
    "Ends: "+escapeHtml(monTime(data.ends_at)),
    "Status: "+escapeHtml(data.status),
    "Reference: "+escapeHtml(shortRef(data.id,data.starts_at)),
    "",
    "Review: https://hair-by-lynna.pages.dev/admin"
  ];
  // Optional customer email via Brevo. Configure BREVO_API_KEY and BOOKING_EMAIL_FROM
  // on Supabase. Email errors must not prevent the already-working Telegram notification.
  const brevoKey=Deno.env.get("BREVO_API_KEY"),sender=Deno.env.get("BOOKING_EMAIL_FROM");
  if(brevoKey&&sender&&typeof data.customer_email==="string"&&data.customer_email.trim()){
    const subject= current.status==="approved" ? "Hair by Lynna — Appointment approved"
      : current.status==="declined" ? "Hair by Lynna — Appointment declined"
      : current.status==="cancelled" ? "Hair by Lynna — Appointment cancelled"
      : heading.includes("rescheduled") ? "Hair by Lynna — Appointment updated"
      : "Hair by Lynna — Booking request received";
    const reference=shortRef(data.id,data.starts_at);
    const privateLink="https://hair-by-lynna.pages.dev/?booking="+encodeURIComponent(data.id)+"&ref="+encodeURIComponent(reference)+"#booking-status";
    const mailText=[
      subject,"", "Hi "+data.customer_name+",",
      "Service: "+(serviceName??"Service"),
      "Date & time: "+monTime(data.starts_at),
      "Status: "+data.status,
      "Reference: "+reference,
      "Check your appointment status ("+reference+"): "+privateLink,
      "", "Keep your booking status link private.",
      "Hair by Lynna"
    ].join("\n");
    const htmlContent=`<!doctype html><html><body style="margin:0;padding:24px 12px;background:#120c13;font-family:Arial,Helvetica,sans-serif;color:#fbeaf3;">
      <div style="max-width:540px;margin:auto;background:#21121e;border:1px solid #b57495;border-radius:12px;padding:28px 22px;">
       <h1 style="color:#f5a6cb;font-size:26px;margin:0 0 18px;">Hair by Lynna</h1>
       <h2 style="font-size:19px;font-weight:600;margin:0 0 18px;">${escapeHtml(subject)}</h2>
       <p>Hi ${escapeHtml(data.customer_name)},</p>
       <p style="line-height:1.8;">Service: <strong>${escapeHtml(serviceName??"Service")}</strong><br/>
       Date &amp; time: <strong>${escapeHtml(monTime(data.starts_at))}</strong><br/>
       Status: <strong>${escapeHtml(data.status)}</strong><br/>
       Reference: <strong style="color:#f2b3d1;">${escapeHtml(reference)}</strong></p>
       <a href="${escapeHtml(privateLink)}" style="display:inline-block;background:#e99ec2;color:#21121e;padding:15px 22px;border-radius:7px;text-decoration:none;font-weight:bold;margin:12px 0;">Check booking status</a>
       <p style="font-size:12px;color:#d3aec0;line-height:1.5;">Use the same email you booked with to view your status. Keep this link private.</p>
       <p style="margin-top:24px;">Hair by Lynna</p>
      </div></body></html>`;
    try {
      const mail=await fetch("https://api.brevo.com/v3/smtp/email",{method:"POST",headers:{
        "api-key":brevoKey,"Content-Type":"application/json","accept":"application/json"
      },body:JSON.stringify({sender:{name:"Hair by Lynna",email:sender},replyTo:{email:"xhair.dreams@gmail.com",name:"Lynna"},to:[{email:data.customer_email,name:data.customer_name}],subject,textContent:mailText,htmlContent})});
      if(!mail.ok)console.error("telegram-booking: customer email failed",mail.status,(await mail.text()).slice(0,400));
      else console.info("telegram-booking: customer email accepted");
    }catch(e){console.error("telegram-booking: customer email network error",String(e));}
  } else if(!brevoKey||!sender){console.info("telegram-booking: customer email not configured; Telegram only");}
  const response=await fetch("https://api.telegram.org/bot"+token+"/sendMessage",{
    method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({chat_id:chatId,text:lines.join("\n"),parse_mode:"HTML",disable_web_page_preview:true})
  });
  if(!response.ok){const body=await response.text(); console.error("telegram-booking: Telegram returned",response.status,body.slice(0,600));return new Response("Telegram delivery failed",{status:502});}
  return new Response("OK",{status:200});
});
