// Supabase Edge Function: booking-reminders
// Called by Supabase Cron every 15 minutes, not by customer browsers.
// Turn Verify JWT OFF in the Supabase dashboard; this function authenticates
// every request with a separate, high-entropy X-Reminder-Secret header.
// Requires migration 018 and BREVO_API_KEY, BOOKING_EMAIL_FROM,
// BOOKING_REMINDER_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
import { createClient } from "npm:@supabase/supabase-js@2";

const logoUrl = "https://hair-by-lynna.pages.dev/images/hair-by-lynna-logo.png";
const website = "https://hair-by-lynna.pages.dev";
const replyToEmail = "xhair.dreams@gmail.com";
// Only the reminder workflow for approved bookings uses this private address.
const approvedLocation = "12151 Place Philippe-Lebon, Montréal, QC H1E 1L6";
const escapeHtml = (value: unknown) => String(value ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

function constantTimeEquals(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  if (x.length !== y.length) return false;
  let difference = 0;
  for (let i = 0; i < x.length; i++) difference |= x[i] ^ y[i];
  return difference === 0;
}
function bookingReference(id: string, iso: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone:"America/Toronto",year:"numeric",month:"2-digit",day:"2-digit",
    hour:"2-digit",minute:"2-digit",hourCycle:"h23"
  }).formatToParts(new Date(iso));
  const get = (part: string) => parts.find(p=>p.type===part)?.value ?? "";
  return "LYN-"+get("year")+get("month")+get("day")+"-"+get("hour")+get("minute")+"-"+id.replace(/-/g,"").slice(0,4).toUpperCase();
}
const montrealTime = (iso: string, language: "en" | "fr") =>
  new Intl.DateTimeFormat(language === "fr" ? "fr-CA" : "en-CA", {
    timeZone:"America/Toronto",dateStyle:"full",timeStyle:"short"
  }).format(new Date(iso));

type DueReminder = { reminder_id: number; appointment_id: string; starts_at: string };
type ServiceName = { name_en?: string; name_fr?: string } | null;
type Appointment = {
  id: string; customer_name: string; customer_email: string;
  starts_at: string; ends_at: string; status: string;
  deposit_amount_cents: number | null; deposit_received_at: string | null;
  reschedule_response: string | null; preferred_language: string | null;
  services: ServiceName | ServiceName[];
};
const money = (cents: number) =>
  new Intl.NumberFormat("en-CA", {style:"currency",currency:"CAD"}).format(cents/100);

function buildEmail(a: Appointment) {
  const lang:"en"|"fr"=a.preferred_language==="fr"?"fr":"en";
  const fr=lang==="fr";
  const service: ServiceName=Array.isArray(a.services)?a.services[0]??null:a.services;
  const name=fr?(service?.name_fr||service?.name_en||"Service de coiffure"):
    (service?.name_en||service?.name_fr||"Braiding service");
  const when=montrealTime(a.starts_at,lang);
  const minutes=Math.max(0,Math.round((new Date(a.ends_at).getTime()-new Date(a.starts_at).getTime())/60000));
  const duration=[
    Math.floor(minutes/60)?Math.floor(minutes/60)+(fr?" h":" hr"+(Math.floor(minutes/60)===1?"":"s")):"",
    minutes%60?minutes%60+" min":""
  ].filter(Boolean).join(" ");
  const amount=money(a.deposit_amount_cents??2000);
  const paid=Boolean(a.deposit_received_at);
  const ref=bookingReference(a.id,a.starts_at);
  const link=website+"/?booking="+encodeURIComponent(a.id)+"&ref="+encodeURIComponent(ref)+"#booking-status";
  const t=fr?{
    subject:"Hair by Lynna — Rappel de rendez-vous",
    hello:"Bonjour",intro:"Votre rendez-vous approuvé est prévu dans environ 12 heures.",
    service:"Coiffure",date:"Date et heure (Montréal)",location:"Adresse du rendez-vous",
    duration:"Durée estimée",reference:"Référence",button:"Consulter mon rendez-vous",
    deposit:paid?"Dépôt de "+amount+" : reçu et confirmé.":
      "Dépôt de "+amount+" : non encore confirmé. Si vous l'avez déjà envoyé, ne faites pas un deuxième virement.",
    foot:"La durée est une estimation. Utilisez votre courriel de réservation pour consulter le statut et gardez votre lien privé."
  }:{
    subject:"Hair by Lynna — Appointment reminder",
    hello:"Hi",intro:"Your approved appointment is in approximately 12 hours.",
    service:"Hairstyle",date:"Date and time (Montréal)",location:"Appointment address",
    duration:"Estimated duration",reference:"Booking reference",button:"Check booking status",
    deposit:paid?"Deposit "+amount+": received and confirmed.":
      "Deposit "+amount+": not yet confirmed. If you've already sent it, please don't send another payment.",
    foot:"Duration is an estimate. Use your booking email to check the status and keep your link private."
  };
  const details=[
    [t.service,name],[t.date,when],[t.location,approvedLocation],
    [t.duration,duration],[t.reference,ref]
  ];
  const textContent=[
    t.subject,"",t.hello+" "+a.customer_name+",","",t.intro,"",
    ...details.map(([k,v])=>k+": "+v),t.deposit,"",
    t.button+": "+link,"",t.foot,"Hair by Lynna"
  ].join("\n");
  const lines=details.map(([k,v])=>escapeHtml(k)+": <strong>"+escapeHtml(v)+"</strong><br/>").join("");
  const htmlContent=[
    '<!doctype html><html lang="'+lang+'"><head><meta charset="utf-8"/></head>',
    '<body style="margin:0;padding:22px 10px;background:#120c13;font-family:Arial,Helvetica,sans-serif;color:#fbeaf3;">',
    '<div style="margin:0 auto;max-width:540px;background:#21121e;border:1px solid #b57495;border-radius:12px;padding:25px 20px;">',
    '<img src="'+logoUrl+'" width="260" alt="Hair by Lynna" style="display:block;width:260px;max-width:100%;height:auto;margin:0 auto 22px;border:0;"/>',
    '<h1 style="color:#f3b4d3;font-size:23px;margin:0 0 18px;line-height:1.3;">'+escapeHtml(t.subject)+'</h1>',
    '<p>'+escapeHtml(t.hello)+' '+escapeHtml(a.customer_name)+',</p>',
    '<p style="line-height:1.7;">'+escapeHtml(t.intro)+'</p>',
    '<div style="background:#311c2b;border:1px solid #855575;border-radius:8px;padding:16px 15px;line-height:1.85;">'+lines+'</div>',
    '<p style="line-height:1.7;">'+escapeHtml(t.deposit)+'</p>',
    '<a href="'+escapeHtml(link)+'" style="display:inline-block;margin:12px 0 8px;background:#e9a2c4;color:#21121e;border-radius:7px;padding:14px 20px;font-weight:bold;text-decoration:none;">'+escapeHtml(t.button)+'</a>',
    '<p style="font-size:12px;line-height:1.7;color:#d7b3c5;">'+escapeHtml(t.foot)+'</p>',
    '<p>Hair by Lynna</p></div></body></html>'
  ].join("");
  return {subject:t.subject,textContent,htmlContent};
}

Deno.serve(async (request) => {
  if(request.method !== "POST")return new Response("Method not allowed",{status:405});
  const expected = Deno.env.get("BOOKING_REMINDER_SECRET") || "";
  const supplied = request.headers.get("X-Reminder-Secret") || "";
  if(expected.length<24 || !constantTimeEquals(supplied,expected))
    return new Response("Unauthorized",{status:401});

  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const brevoKey = Deno.env.get("BREVO_API_KEY");
  const from = Deno.env.get("BOOKING_EMAIL_FROM");
  if(!url||!key||!brevoKey||!from) {
    console.error("booking-reminders: required Supabase or Brevo configuration missing");
    return new Response("Not configured",{status:503});
  }
  const db = createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:claimed,error:claimError} = await db.rpc("claim_due_appointment_reminders",{p_limit:20});
  if(claimError){
    console.error("booking-reminders: claim error",claimError.code,claimError.message);
    return new Response("Could not load reminders",{status:503});
  }
  let sent=0,failed=0,skipped=0;
  for(const reminder of (claimed||[]) as DueReminder[]){
    let outcome: "sent"|"failed"|"skipped" = "failed";
    let errorMessage: string | null = null;
    try{
      // A booking may have been cancelled or rescheduled after the cron claim.
      // Query fresh state, and never send for a disputed reschedule.
      const {data:record,error:lookupError} = await db.from("appointments")
        .select("id,customer_name,customer_email,starts_at,ends_at,status,reschedule_response,deposit_amount_cents,deposit_received_at,preferred_language,services(name_en,name_fr)")
        .eq("id",reminder.appointment_id).maybeSingle();
      if(lookupError)throw Error("appointment lookup failed: "+(lookupError.code||"unknown"));
      const a = record as Appointment | null;
      const stillEligible = Boolean(a && a.status==="approved" &&
        new Date(a.starts_at).getTime()===new Date(reminder.starts_at).getTime() &&
        (a.reschedule_response===null||a.reschedule_response==="confirmed") &&
        a.customer_email?.trim());
      if(!stillEligible){
        outcome="skipped";
      }else{
        const mail=buildEmail(a!);
        const response=await fetch("https://api.brevo.com/v3/smtp/email",{
          method:"POST",
          headers:{"api-key":brevoKey,"Content-Type":"application/json","accept":"application/json"},
          body:JSON.stringify({
            sender:{name:"Hair by Lynna",email:from},
            replyTo:{name:"Lynna",email:replyToEmail},
            to:[{email:a!.customer_email,name:a!.customer_name}],
            subject:mail.subject,textContent:mail.textContent,htmlContent:mail.htmlContent
          }),
          signal:AbortSignal.timeout(15000)
        });
        if(!response.ok)throw Error("Brevo HTTP "+response.status);
        outcome="sent";
      }
    }catch(e){errorMessage=String((e as Error)?.message||"Email not accepted");}
    try{
      const {error:finishError}=await db.rpc("finish_appointment_reminder",{
        p_reminder_id:reminder.reminder_id,p_outcome:outcome,p_error:errorMessage
      });
      if(finishError)throw Error(finishError.message);
      if(outcome==="sent")sent++;else if(outcome==="skipped")skipped++;else failed++;
    }catch(e){
      failed++;
      console.error("booking-reminders: unable to record delivery result",String(e));
    }
  }
  console.info("booking-reminders: processed",{sent,failed,skipped});
  return Response.json({ok:true,sent,failed,skipped});
});
