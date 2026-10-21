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
  // Optional customer email via Resend. Configure RESEND_API_KEY and BOOKING_EMAIL_FROM
  // on Supabase. Email errors must not prevent the already-working Telegram notification.
  const resendKey=Deno.env.get("RESEND_API_KEY"),sender=Deno.env.get("BOOKING_EMAIL_FROM");
  if(resendKey&&sender&&typeof data.customer_email==="string"&&data.customer_email.trim()){
    const subject= current.status==="approved" ? "Hair by Lynna — Appointment approved"
      : current.status==="declined" ? "Hair by Lynna — Appointment declined"
      : current.status==="cancelled" ? "Hair by Lynna — Appointment cancelled"
      : heading.includes("rescheduled") ? "Hair by Lynna — Appointment updated"
      : "Hair by Lynna — Booking request received";
    const privateLink="https://hair-by-lynna.pages.dev/?booking="+encodeURIComponent(data.id)+"#booking-status";
    const mailText=[
      subject,"", "Hi "+data.customer_name+",",
      "Service: "+(serviceName??"Service"),
      "Date & time: "+monTime(data.starts_at),
      "Status: "+data.status,
      "Reference: "+shortRef(data.id,data.starts_at),
      "Check your appointment status: "+privateLink,
      "", "This request is subject to Lynna's approval. The booking link is private; keep it safe.",
      "Hair by Lynna"
    ].join("\n");
    try {
      const mail=await fetch("https://api.resend.com/emails",{method:"POST",headers:{
        "Authorization":"Bearer "+resendKey,"Content-Type":"application/json"
      },body:JSON.stringify({from:sender,to:[data.customer_email],subject,text:mailText})});
      if(!mail.ok)console.error("telegram-booking: customer email failed",mail.status,(await mail.text()).slice(0,400));
      else console.info("telegram-booking: customer email accepted");
    }catch(e){console.error("telegram-booking: customer email network error",String(e));}
  } else if(!resendKey||!sender){console.info("telegram-booking: customer email not configured; Telegram only");}
  const response=await fetch("https://api.telegram.org/bot"+token+"/sendMessage",{
    method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({chat_id:chatId,text:lines.join("\n"),parse_mode:"HTML",disable_web_page_preview:true})
  });
  if(!response.ok){const body=await response.text(); console.error("telegram-booking: Telegram returned",response.status,body.slice(0,600));return new Response("Telegram delivery failed",{status:502});}
  return new Response("OK",{status:200});
});
