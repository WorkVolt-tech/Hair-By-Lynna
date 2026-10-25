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
  // The BEFORE UPDATE trigger records the real event; webhook old_record may only
  // contain a primary key and must not be used to infer an approval.
  let event=payload.type==="INSERT"?"created":
    (typeof current.last_booking_event==="string"?current.last_booking_event:"");
  if(!event && payload.type==="UPDATE"){
    // Compatibility with older events that included the full old row.
    if(typeof previous.starts_at==="string"&&previous.starts_at!==current.starts_at) event="rescheduled";
    else if(typeof previous.ends_at==="string"&&previous.ends_at!==current.ends_at)event="rescheduled";
    else if(typeof previous.status==="string"&&previous.status!==current.status)event=String(current.status);
  }
  const headings:Record<string,string>={
    created:"🆕 New appointment request",
    approved:"✅ Appointment approved",
    declined:"❌ Appointment declined",
    cancelled:"🚫 Appointment cancelled",
    rescheduled:"📅 Appointment time changed — awaiting customer confirmation",
    reschedule_confirmed:"✅ Customer confirmed the new appointment time",
    reschedule_needs_contact:"⚠️ Customer cannot attend the proposed time — follow up needed",
    deposit_received:"💗 Deposit verified as received",
    deposit_unconfirmed:"⚠️ Deposit confirmation reversed — follow-up needed"
  };
  if(event==="created"&&current.status!=="pending")return new Response("No notification needed",{status:200});
  const heading=headings[event]||"";
  if(!heading)return new Response("No notification needed",{status:200});
  const db=createClient(supabaseUrl,serviceKey,{auth:{persistSession:false}});
  const {data,error}=await db.from("appointments")
    .select("id,customer_name,customer_email,starts_at,ends_at,status,reschedule_previous_starts_at,reschedule_previous_ends_at,reschedule_response,deposit_amount_cents,deposit_received_at,services(name_en)")
    .eq("id",current.id).single();
  if(error||!data){console.error("telegram-booking: appointment lookup failed",{code:error?.code,message:error?.message});return new Response("Appointment lookup failed",{status:500});}
  const serviceName=Array.isArray(data.services)?data.services[0]?.name_en:(data.services as {name_en?:string}|null)?.name_en;
  const rescheduled=event==="rescheduled";
  const oldTime=data.reschedule_previous_starts_at?monTime(data.reschedule_previous_starts_at):null;
  // Use the booked appointment's reserved duration, not the service's current
  // duration setting: later service edits must not rewrite an existing estimate.
  const reservedMinutes=Math.round((new Date(data.ends_at).getTime()-new Date(data.starts_at).getTime())/60000);
  const durationEstimate=Number.isFinite(reservedMinutes)&&reservedMinutes>0
    ? [Math.floor(reservedMinutes/60)?Math.floor(reservedMinutes/60)+" "+(Math.floor(reservedMinutes/60)===1?"hr":"hrs"):"",
       reservedMinutes%60?(reservedMinutes%60)+" "+(reservedMinutes%60===1?"min":"mins"):""].filter(Boolean).join(" ")
    : null;
  const depositPaid=Boolean(data.deposit_received_at);
  const depositAmount=new Intl.NumberFormat("en-CA",{style:"currency",currency:"CAD"}).format((data.deposit_amount_cents??2000)/100);
  const depositLabel=depositPaid?"Received":"Not received";
  const transferEmail="xhair.dreams@gmail.com";
  const activeAppointment=data.status==="pending"||data.status==="approved";
  const paymentInstructions=activeAppointment&&!depositPaid;
  const lines=[
    heading,
    "",
    "Client: "+escapeHtml(data.customer_name),
    "Service: "+escapeHtml(serviceName??"Service"),
    ...(rescheduled&&oldTime?["Previous time: "+escapeHtml(oldTime)]:[]),
    (rescheduled?"New time: ":"Starts: ")+escapeHtml(monTime(data.starts_at)),
    "Ends: "+escapeHtml(monTime(data.ends_at)),
    "Status: "+escapeHtml(data.status),
    "Deposit: "+escapeHtml(depositAmount+" — "+depositLabel),
    ...(rescheduled?["Customer response: awaiting confirmation"]:[]),
    ...(event==="reschedule_confirmed"?["Customer response: confirmed new time"]:[]),
    ...(event==="reschedule_needs_contact"?["Customer response: cannot attend proposed time; please contact customer"]:[]),
    "Reference: "+escapeHtml(shortRef(data.id,data.starts_at)),
    "",
    "Review: https://hair-by-lynna.pages.dev/admin"
  ];
  // Optional customer email via Brevo. Configure BREVO_API_KEY and BOOKING_EMAIL_FROM
  // on Supabase. Email errors must not prevent the already-working Telegram notification.
  const brevoKey=Deno.env.get("BREVO_API_KEY"),sender=Deno.env.get("BOOKING_EMAIL_FROM");
  if(brevoKey&&sender&&typeof data.customer_email==="string"&&data.customer_email.trim()){
    const subjects:Record<string,string>={
      created:"Hair by Lynna — Booking request received",
      approved:"Hair by Lynna — Appointment approved",
      declined:"Hair by Lynna — Appointment declined",
      cancelled:"Hair by Lynna — Appointment cancelled",
      rescheduled:"Hair by Lynna — Your appointment time has changed",
      reschedule_confirmed:"Hair by Lynna — New appointment time confirmed",
      reschedule_needs_contact:"Hair by Lynna — We received your scheduling concern",
      deposit_received:"Hair by Lynna — Deposit received",
      deposit_unconfirmed:"Hair by Lynna — Deposit status corrected"
    };
    const subject=subjects[event]||"Hair by Lynna — Appointment update";
    const reference=shortRef(data.id,data.starts_at);
    const privateLink="https://hair-by-lynna.pages.dev/?booking="+encodeURIComponent(data.id)+"&ref="+encodeURIComponent(reference)+"#booking-status";
    const mailText=[
      subject,"", "Hi "+data.customer_name+",",
      "Service: "+(serviceName??"Service"),
      ...(rescheduled&&oldTime?["Previous date & time: "+oldTime]:[]),
      (rescheduled?"New proposed date & time: ":"Date & time: ")+monTime(data.starts_at),
      ...(durationEstimate?["Estimated duration: "+durationEstimate]:[]),
      "Status: "+data.status,
      "Deposit: "+depositAmount+" — "+depositLabel,
      ...(event==="deposit_received"?["We have confirmed receipt of your deposit. It will be deducted from your final bill."]:[]),
      ...(event==="deposit_unconfirmed"?["Your deposit confirmation was corrected. If you already transferred the deposit, please contact Lynna before sending another payment."]:[]),
      ...(paymentInstructions?["Interac e-Transfer: "+transferEmail,
        "Include your booking reference in the e-Transfer message. Lynna will manually confirm the payment after checking her account.",
        "If you've already sent it, please do not send it again. Wait for Lynna's confirmation."]:[]),
      ...(rescheduled?["Please open the booking-status link and confirm whether you can attend the new time."]:[]),
      ...(event==="reschedule_confirmed"?["Thank you for confirming your new appointment time."]:[]),
      ...(event==="reschedule_needs_contact"?["We received your response. Lynna can contact you to arrange another time. Your appointment has not been cancelled."]:[]),
      "Reference: "+reference,
      "Check your appointment status ("+reference+"): "+privateLink,
      "", "Keep your booking status link private.",
      "Hair by Lynna"
    ].join("\n");
    const htmlContent=`<!doctype html><html><body style="margin:0;padding:24px 12px;background:#120c13;font-family:Arial,Helvetica,sans-serif;color:#fbeaf3;">
      <div style="max-width:540px;margin:auto;background:#21121e;border:1px solid #b57495;border-radius:12px;padding:28px 22px;">
       <img src="https://hair-by-lynna.pages.dev/images/hair-by-lynna-logo.png" alt="Hair by Lynna" width="260" style="display:block;width:260px;max-width:100%;height:auto;margin:0 auto 22px;border:0;outline:none;text-decoration:none;" />
       <h2 style="font-size:19px;font-weight:600;margin:0 0 18px;">${escapeHtml(subject)}</h2>
       <p>Hi ${escapeHtml(data.customer_name)},</p>
       <p style="line-height:1.8;">Service: <strong>${escapeHtml(serviceName??"Service")}</strong><br/>
       ${rescheduled&&oldTime?'Previous date &amp; time: <strong>'+escapeHtml(oldTime)+'</strong><br/>':''}
       ${rescheduled?'New proposed date &amp; time:':'Date &amp; time:'} <strong>${escapeHtml(monTime(data.starts_at))}</strong><br/>
       ${durationEstimate?'Estimated duration: <strong>'+escapeHtml(durationEstimate)+'</strong><br/>':''}
       Status: <strong>${escapeHtml(data.status)}</strong><br/>
       Deposit: <strong>${escapeHtml(depositAmount+" — "+depositLabel)}</strong><br/>
       Reference: <strong style="color:#f2b3d1;">${escapeHtml(reference)}</strong></p>
       ${rescheduled?'<p style="color:#ffd6e9;font-weight:bold;">Please confirm the new appointment time or let Lynna know if you cannot attend, using the link below.</p>':''}
       ${event==="deposit_received"?'<p style="color:#ffcbe1;font-weight:bold;">Your deposit has been received and will be deducted from the final bill. Thank you!</p>':''}
       ${event==="deposit_unconfirmed"?'<p style="color:#ffcbe1;">Your deposit confirmation has been corrected. If you already sent the transfer, contact Lynna before sending another payment.</p>':''}
       ${paymentInstructions?'<div style="padding:15px;margin:14px 0;border-radius:8px;border:1px solid #b57495;background:#311c2b;"><strong style="color:#ffcbe1;">Pay deposit by Interac e-Transfer</strong><p>Send '+escapeHtml(depositAmount)+' to <strong>'+escapeHtml(transferEmail)+'</strong>. Add your booking reference to the transfer message.</p><p style="font-size:12px;">Lynna will verify the transfer manually. If you already sent it, do not send another; wait for confirmation.</p></div>':''}
       ${event==="reschedule_needs_contact"?'<p>Lynna has been informed that the proposed time does not work for you. She can follow up to arrange another time. Your booking remains active.</p>':''}
       <a href="${escapeHtml(privateLink)}" style="display:inline-block;background:#e99ec2;color:#21121e;padding:15px 22px;border-radius:7px;text-decoration:none;font-weight:bold;margin:12px 0;">${rescheduled?'Respond to new appointment time':'Check booking status'}</a>
       ${durationEstimate?'<p style="font-size:12px;color:#d3aec0;line-height:1.5;">The duration is an estimate and may vary depending on your hair and styling needs.</p>':''}
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
