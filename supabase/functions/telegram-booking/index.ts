// Supabase Edge Function: telegram-booking
// Deploy via Supabase Dashboard > Edge Functions, with JWT verification OFF.
// Protected by X-Webhook-Secret (shared with Database Webhook), not callable openly.
// Customer emails use the language saved on the booking (appointments.preferred_language,
// migration 023). Lynna's Telegram alerts always stay in English.
import { createClient } from "npm:@supabase/supabase-js@2";

const token = Deno.env.get("TELEGRAM_BOT_TOKEN");
const chatId = Deno.env.get("TELEGRAM_CHAT_ID");
const secret = Deno.env.get("BOOKING_WEBHOOK_SECRET");
const supabaseUrl = Deno.env.get("SUPABASE_URL");
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
type Lang = "en" | "fr";
const escapeHtml = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const monTime = (iso: string, lang: Lang = "en") => new Intl.DateTimeFormat(lang === "fr" ? "fr-CA" : "en-CA", {timeZone:"America/Toronto",dateStyle:"full",timeStyle:"short"}).format(new Date(iso));
function shortRef(id: string, iso: string) {
  const parts=new Intl.DateTimeFormat("en-CA",{timeZone:"America/Toronto",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(new Date(iso));
  const val=(part:string)=>parts.find(p=>p.type===part)?.value??"";
  return "LYN-"+val("year")+val("month")+val("day")+"-"+val("hour")+val("minute")+"-"+id.replace(/-/g,"").slice(0,4).toUpperCase();
}

// ---------- Customer email wording, English and French ----------
const SUBJECTS: Record<Lang, Record<string,string>> = {
  en: {
    created:"Hair by Lynna — Booking request received",
    approved:"Hair by Lynna — Appointment approved",
    declined:"Hair by Lynna — Appointment declined",
    cancelled:"Hair by Lynna — Appointment cancelled",
    rescheduled:"Hair by Lynna — Your appointment time has changed",
    reschedule_confirmed:"Hair by Lynna — New appointment time confirmed",
    reschedule_needs_contact:"Hair by Lynna — We received your scheduling concern",
    deposit_received:"Hair by Lynna — Deposit received",
    deposit_unconfirmed:"Hair by Lynna — Deposit status corrected",
    fallback:"Hair by Lynna — Appointment update"
  },
  fr: {
    created:"Hair by Lynna — Demande de rendez-vous reçue",
    approved:"Hair by Lynna — Rendez-vous approuvé",
    declined:"Hair by Lynna — Rendez-vous refusé",
    cancelled:"Hair by Lynna — Rendez-vous annulé",
    rescheduled:"Hair by Lynna — L’heure de votre rendez-vous a changé",
    reschedule_confirmed:"Hair by Lynna — Nouvelle heure de rendez-vous confirmée",
    reschedule_needs_contact:"Hair by Lynna — Nous avons bien reçu votre réponse",
    deposit_received:"Hair by Lynna — Dépôt reçu",
    deposit_unconfirmed:"Hair by Lynna — Statut du dépôt corrigé",
    fallback:"Hair by Lynna — Mise à jour de votre rendez-vous"
  }
};
const STATUS: Record<Lang, Record<string,string>> = {
  en: {pending:"Pending",approved:"Approved",declined:"Declined",cancelled:"Cancelled",completed:"Completed"},
  fr: {pending:"En attente",approved:"Approuvé",declined:"Refusé",cancelled:"Annulé",completed:"Terminé"}
};
const T = {
  en: {
    hi:"Hi", service:"Service", serviceFallback:"Service",
    previous:"Previous date & time", newTime:"New proposed date & time", dateTime:"Date & time",
    duration:"Estimated duration", status:"Status", deposit:"Deposit", reference:"Reference",
    received:"Received", notReceived:"Not received", reportedPending:"Customer reported sent; Lynna verification pending",
    addressTitle:"Appointment address", addressPrivate:"Please keep this location private.",
    depositReceivedMsg:"Your deposit has been received and will be deducted from your final bill. Thank you!",
    depositUnconfirmedMsg:"Your deposit confirmation was corrected. If you already sent the transfer, please contact Lynna before sending another payment.",
    reportedMsg:"You reported sending your Interac deposit. Lynna will verify it manually before confirming receipt. Please do not send another payment.",
    payTitle:"Pay your deposit by Interac e-Transfer",
    payBody:(amount:string,email:string)=>"Send "+amount+" to "+email+". Add your booking reference to the transfer message.",
    payNote:"Lynna will verify the transfer manually. If you already sent it, do not send another; wait for her confirmation.",
    alreadySent:"Already sent your deposit?", reportButton:"I’ve sent my deposit",
    reportHelp:"Open the link, verify your booking email, then report the transfer. Lynna still checks Interac manually.",
    rescheduledMsg:"Please confirm the new appointment time, or let Lynna know if you cannot attend, using the link below.",
    rescheduleConfirmedMsg:"Thank you for confirming your new appointment time.",
    needsContactMsg:"Lynna has been told that the proposed time does not work for you. She can contact you to arrange another time. Your booking remains active.",
    statusButton:"Check booking status", respondButton:"Respond to new appointment time",
    statusLinkText:"Check your appointment status",
    durationNote:"The duration is an estimate and may vary depending on your hair and styling needs.",
    privacyNote:"Use the same email you booked with to view your status. Keep this link private.",
    hours:(h:number)=>h+" "+(h===1?"hr":"hrs"), minutes:(m:number)=>m+" "+(m===1?"min":"mins"), colon:": "
  },
  fr: {
    hi:"Bonjour", service:"Coiffure", serviceFallback:"Service de coiffure",
    previous:"Ancienne date et heure", newTime:"Nouvelle date et heure proposée", dateTime:"Date et heure",
    duration:"Durée estimée", status:"Statut", deposit:"Dépôt", reference:"Référence",
    received:"Reçu", notReceived:"Non reçu", reportedPending:"Envoi déclaré par la cliente; vérification par Lynna en cours",
    addressTitle:"Adresse du rendez-vous", addressPrivate:"Merci de garder cette adresse privée.",
    depositReceivedMsg:"Votre dépôt a bien été reçu et sera déduit de votre facture finale. Merci!",
    depositUnconfirmedMsg:"La confirmation de votre dépôt a été corrigée. Si vous avez déjà envoyé le virement, contactez Lynna avant d’envoyer un autre paiement.",
    reportedMsg:"Vous avez déclaré avoir envoyé votre dépôt Interac. Lynna le vérifiera manuellement avant de confirmer sa réception. Merci de ne pas envoyer un deuxième paiement.",
    payTitle:"Payez votre dépôt par virement Interac",
    payBody:(amount:string,email:string)=>"Envoyez "+amount+" à "+email+". Ajoutez votre référence de réservation dans le message du virement.",
    payNote:"Lynna vérifiera le virement manuellement. Si vous l’avez déjà envoyé, n’en envoyez pas un autre; attendez sa confirmation.",
    alreadySent:"Vous avez déjà envoyé votre dépôt?", reportButton:"J’ai envoyé mon dépôt",
    reportHelp:"Ouvrez le lien, confirmez votre courriel de réservation, puis déclarez le virement. Lynna vérifie toujours Interac manuellement.",
    rescheduledMsg:"Veuillez confirmer la nouvelle heure de rendez-vous, ou indiquer à Lynna que vous ne pouvez pas venir, avec le lien ci-dessous.",
    rescheduleConfirmedMsg:"Merci d’avoir confirmé la nouvelle heure de votre rendez-vous.",
    needsContactMsg:"Lynna a été informée que l’heure proposée ne vous convient pas. Elle pourra vous contacter pour trouver un autre moment. Votre réservation reste active.",
    statusButton:"Consulter ma réservation", respondButton:"Répondre à la nouvelle heure",
    statusLinkText:"Consultez le statut de votre rendez-vous",
    durationNote:"La durée est une estimation et peut varier selon vos cheveux et le style choisi.",
    privacyNote:"Utilisez le même courriel que lors de votre réservation pour consulter le statut. Gardez ce lien privé.",
    hours:(h:number)=>h+" h", minutes:(m:number)=>m+" min", colon:"\u00a0: "
  }
};

type EmailInput = {
  lang: Lang; event: string; customerName: string; serviceName: string; status: string;
  startsAt: string; oldStartsAt: string|null; reservedMinutes: number;
  depositCents: number; depositPaid: boolean; depositReported: boolean;
  showApprovedLocation: boolean; paymentInstructions: boolean;
  reference: string; privateLink: string; reportLink: string;
  approvedLocation: string; transferEmail: string;
};
export function buildCustomerEmail(i: EmailInput) {
  const t = T[i.lang];
  const subject = SUBJECTS[i.lang][i.event] || SUBJECTS[i.lang].fallback;
  const rescheduled = i.event === "rescheduled";
  const when = monTime(i.startsAt, i.lang);
  const oldTime = i.oldStartsAt ? monTime(i.oldStartsAt, i.lang) : null;
  const m = i.reservedMinutes;
  const durationEstimate = Number.isFinite(m) && m > 0
    ? [Math.floor(m/60) ? t.hours(Math.floor(m/60)) : "", m%60 ? t.minutes(m%60) : ""].filter(Boolean).join(" ")
    : null;
  const depositAmount = new Intl.NumberFormat(i.lang==="fr"?"fr-CA":"en-CA",{style:"currency",currency:"CAD"}).format(i.depositCents/100);
  const depositState = i.depositPaid ? t.received : i.depositReported ? t.reportedPending : t.notReceived;
  const statusLabel = STATUS[i.lang][i.status] || i.status;

  const textContent = [
    subject, "", t.hi+" "+i.customerName+",", "",
    t.service+t.colon+i.serviceName,
    ...(rescheduled&&oldTime ? [t.previous+t.colon+oldTime] : []),
    (rescheduled ? t.newTime : t.dateTime)+t.colon+when,
    ...(durationEstimate ? [t.duration+t.colon+durationEstimate] : []),
    t.status+t.colon+statusLabel,
    ...(i.showApprovedLocation ? [t.addressTitle+t.colon+i.approvedLocation, t.addressPrivate] : []),
    t.deposit+t.colon+depositAmount+" — "+depositState,
    ...(i.event==="deposit_received" ? [t.depositReceivedMsg] : []),
    ...(i.event==="deposit_unconfirmed" ? [t.depositUnconfirmedMsg] : []),
    ...(i.depositReported ? [t.reportedMsg] : []),
    ...(i.paymentInstructions ? ["", t.payTitle, t.payBody(depositAmount, i.transferEmail), t.payNote,
                                 t.alreadySent+" "+t.reportButton+t.colon+i.reportLink] : []),
    ...(rescheduled ? [t.rescheduledMsg] : []),
    ...(i.event==="reschedule_confirmed" ? [t.rescheduleConfirmedMsg] : []),
    ...(i.event==="reschedule_needs_contact" ? [t.needsContactMsg] : []),
    "", t.reference+t.colon+i.reference,
    t.statusLinkText+" ("+i.reference+")"+t.colon+i.privateLink,
    "", t.privacyNote,
    "Hair by Lynna"
  ].join("\n");

  const box = (inner: string) => '<div style="padding:15px;margin:14px 0;border-radius:8px;border:1px solid #b57495;background:#311c2b;">'+inner+'</div>';
  const htmlContent = `<!doctype html><html lang="${i.lang}"><head><meta charset="utf-8"/></head><body style="margin:0;padding:24px 12px;background:#120c13;font-family:Arial,Helvetica,sans-serif;color:#fbeaf3;">
      <div style="max-width:540px;margin:auto;background:#21121e;border:1px solid #b57495;border-radius:12px;padding:28px 22px;">
       <img src="https://hair-by-lynna.pages.dev/images/hair-by-lynna-logo.png" alt="Hair by Lynna" width="260" style="display:block;width:260px;max-width:100%;height:auto;margin:0 auto 22px;border:0;outline:none;text-decoration:none;" />
       <h2 style="font-size:19px;font-weight:600;margin:0 0 18px;">${escapeHtml(subject)}</h2>
       <p>${escapeHtml(t.hi)} ${escapeHtml(i.customerName)},</p>
       <p style="line-height:1.8;">${escapeHtml(t.service)}${escapeHtml(t.colon)}<strong>${escapeHtml(i.serviceName)}</strong><br/>
       ${rescheduled&&oldTime ? escapeHtml(t.previous)+escapeHtml(t.colon)+'<strong>'+escapeHtml(oldTime)+'</strong><br/>' : ''}
       ${escapeHtml(rescheduled ? t.newTime : t.dateTime)}${escapeHtml(t.colon)}<strong>${escapeHtml(when)}</strong><br/>
       ${durationEstimate ? escapeHtml(t.duration)+escapeHtml(t.colon)+'<strong>'+escapeHtml(durationEstimate)+'</strong><br/>' : ''}
       ${escapeHtml(t.status)}${escapeHtml(t.colon)}<strong>${escapeHtml(statusLabel)}</strong><br/>
       ${escapeHtml(t.deposit)}${escapeHtml(t.colon)}<strong>${escapeHtml(depositAmount+" — "+depositState)}</strong><br/>
       ${escapeHtml(t.reference)}${escapeHtml(t.colon)}<strong style="color:#f2b3d1;">${escapeHtml(i.reference)}</strong></p>
       ${i.showApprovedLocation ? box('<strong style="color:#ffcbe1;">'+escapeHtml(t.addressTitle)+'</strong><p style="margin:8px 0 0;line-height:1.7;">'+escapeHtml(i.approvedLocation)+'</p><p style="font-size:12px;color:#d3aec0;margin:8px 0 0;">'+escapeHtml(t.addressPrivate)+'</p>') : ''}
       ${rescheduled ? '<p style="color:#ffd6e9;font-weight:bold;">'+escapeHtml(t.rescheduledMsg)+'</p>' : ''}
       ${i.event==="deposit_received" ? '<p style="color:#ffcbe1;font-weight:bold;">'+escapeHtml(t.depositReceivedMsg)+'</p>' : ''}
       ${i.event==="deposit_unconfirmed" ? '<p style="color:#ffcbe1;">'+escapeHtml(t.depositUnconfirmedMsg)+'</p>' : ''}
       ${i.depositReported ? '<p style="color:#ffd6e9;font-weight:bold;">'+escapeHtml(t.reportedMsg)+'</p>' : ''}
       ${i.paymentInstructions ? box('<strong style="color:#ffcbe1;">'+escapeHtml(t.payTitle)+'</strong><p>'+escapeHtml(t.payBody(depositAmount, i.transferEmail))+'</p><p style="font-size:12px;">'+escapeHtml(t.payNote)+'</p>') : ''}
       ${i.event==="reschedule_confirmed" ? '<p>'+escapeHtml(t.rescheduleConfirmedMsg)+'</p>' : ''}
       ${i.event==="reschedule_needs_contact" ? '<p>'+escapeHtml(t.needsContactMsg)+'</p>' : ''}
       ${i.paymentInstructions ? '<p style="font-size:13px;line-height:1.6;margin:12px 0 4px;">'+escapeHtml(t.alreadySent)+'</p><a href="'+escapeHtml(i.reportLink)+'" style="display:inline-block;background:#f6bdd9;color:#271323;padding:13px 17px;border-radius:7px;text-decoration:none;font-weight:bold;margin:5px 0 12px;">'+escapeHtml(t.reportButton)+'</a><p style="font-size:12px;color:#d3aec0;">'+escapeHtml(t.reportHelp)+'</p>' : ''}
       <a href="${escapeHtml(i.privateLink)}" style="display:inline-block;background:#e99ec2;color:#21121e;padding:15px 22px;border-radius:7px;text-decoration:none;font-weight:bold;margin:12px 0;">${escapeHtml(rescheduled ? t.respondButton : t.statusButton)}</a>
       ${durationEstimate ? '<p style="font-size:12px;color:#d3aec0;line-height:1.5;">'+escapeHtml(t.durationNote)+'</p>' : ''}
       <p style="font-size:12px;color:#d3aec0;line-height:1.5;">${escapeHtml(t.privacyNote)}</p>
       <p style="margin-top:24px;">Hair by Lynna</p>
      </div></body></html>`;
  return { subject, textContent, htmlContent };
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
    .select("id,customer_name,customer_email,starts_at,ends_at,status,reschedule_previous_starts_at,reschedule_previous_ends_at,reschedule_response,deposit_amount_cents,deposit_received_at,deposit_reported_sent_at,preferred_language,services(name_en,name_fr)")
    .eq("id",current.id).single();
  if(error||!data){console.error("telegram-booking: appointment lookup failed",{code:error?.code,message:error?.message});return new Response("Appointment lookup failed",{status:500});}
  const svc=(Array.isArray(data.services)?data.services[0]:data.services) as {name_en?:string;name_fr?:string}|null;
  const serviceName=svc?.name_en;
  const lang:Lang=data.preferred_language==="fr"?"fr":"en";
  const rescheduled=event==="rescheduled";
  const oldTime=data.reschedule_previous_starts_at?monTime(data.reschedule_previous_starts_at):null;
  // Use the booked appointment's reserved duration, not the service's current
  // duration setting: later service edits must not rewrite an existing estimate.
  const reservedMinutes=Math.round((new Date(data.ends_at).getTime()-new Date(data.starts_at).getTime())/60000);
  const depositPaid=Boolean(data.deposit_received_at);
  const depositReported=Boolean(data.deposit_reported_sent_at);
  const depositAmount=new Intl.NumberFormat("en-CA",{style:"currency",currency:"CAD"}).format((data.deposit_amount_cents??2000)/100);
  const depositLabel=depositPaid?"Received":"Not received";
  const transferEmail="hairbylynna@gmail.com";
  // Only share the private service address with customers whose booking is
  // approved. Never include it in an initial pending request or rejection.
  const approvedLocation="12151 Place Philippe-Lebon, Montréal, QC H1E 1L6";
  const showApprovedLocation=data.status==="approved";
  const activeAppointment=data.status==="pending"||data.status==="approved";
  const paymentInstructions=activeAppointment&&!depositPaid&&!depositReported;
  // Telegram message for Lynna: always English (unchanged).
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
    "Customer language: "+(lang==="fr"?"French":"English"),
    ...(rescheduled?["Customer response: awaiting confirmation"]:[]),
    ...(event==="reschedule_confirmed"?["Customer response: confirmed new time"]:[]),
    ...(event==="reschedule_needs_contact"?["Customer response: cannot attend proposed time; please contact customer"]:[]),
    "Reference: "+escapeHtml(shortRef(data.id,data.starts_at)),
    "",
    "Review: https://hair-by-lynna.pages.dev/admin"
  ];
  // Customer email via Brevo, in the booking's language. Email errors must never
  // prevent the Telegram notification below.
  const brevoKey=Deno.env.get("BREVO_API_KEY"),sender=Deno.env.get("BOOKING_EMAIL_FROM");
  if(brevoKey&&sender&&typeof data.customer_email==="string"&&data.customer_email.trim()){
    try {
      const reference=shortRef(data.id,data.starts_at);
      const privateLink="https://hair-by-lynna.pages.dev/?booking="+encodeURIComponent(data.id)+"&ref="+encodeURIComponent(reference)+"#booking-status";
      const reportLink=privateLink.replace("#booking-status","&deposit=sent#booking-status");
      const t=T[lang];
      const mail=buildCustomerEmail({
        lang,event,customerName:data.customer_name,
        serviceName:(lang==="fr"?(svc?.name_fr||svc?.name_en):(svc?.name_en||svc?.name_fr))||t.serviceFallback,
        status:data.status,startsAt:data.starts_at,oldStartsAt:data.reschedule_previous_starts_at??null,
        reservedMinutes,depositCents:data.deposit_amount_cents??2000,depositPaid,depositReported,
        showApprovedLocation,paymentInstructions,reference,privateLink,reportLink,approvedLocation,transferEmail
      });
      const sent=await fetch("https://api.brevo.com/v3/smtp/email",{method:"POST",headers:{
        "api-key":brevoKey,"Content-Type":"application/json","accept":"application/json"
      },body:JSON.stringify({sender:{name:"Hair by Lynna",email:sender},replyTo:{email:"hairbylynna@gmail.com",name:"Lynna"},to:[{email:data.customer_email,name:data.customer_name}],subject:mail.subject,textContent:mail.textContent,htmlContent:mail.htmlContent})});
      if(!sent.ok)console.error("telegram-booking: customer email failed",sent.status,(await sent.text()).slice(0,400));
      else console.info("telegram-booking: customer email accepted ("+lang+")");
    }catch(e){console.error("telegram-booking: customer email error",String(e));}
  } else if(!brevoKey||!sender){console.info("telegram-booking: customer email not configured; Telegram only");}
  const response=await fetch("https://api.telegram.org/bot"+token+"/sendMessage",{
    method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({chat_id:chatId,text:lines.join("\n"),parse_mode:"HTML",disable_web_page_preview:true})
  });
  if(!response.ok){const body=await response.text(); console.error("telegram-booking: Telegram returned",response.status,body.slice(0,600));return new Response("Telegram delivery failed",{status:502});}
  return new Response("OK",{status:200});
});
