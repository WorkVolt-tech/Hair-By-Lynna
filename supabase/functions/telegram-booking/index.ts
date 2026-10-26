// Supabase Edge Function: telegram-booking
// Deploy via Supabase Dashboard > Edge Functions, with JWT verification OFF.
// Protected by X-Webhook-Secret (shared with Database Webhook), not callable openly.
import { createClient } from "npm:@supabase/supabase-js@2";

const token = Deno.env.get("TELEGRAM_BOT_TOKEN");
const chatId = Deno.env.get("TELEGRAM_CHAT_ID");
const secret = Deno.env.get("BOOKING_WEBHOOK_SECRET");
const supabaseUrl = Deno.env.get("SUPABASE_URL");
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const escapeHtml = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g,"&quot;");
const monTime = (iso: string,lang:"en"|"fr"="en") => new Intl.DateTimeFormat(lang==="fr"?"fr-CA":"en-CA", {timeZone:"America/Toronto",dateStyle:"full",timeStyle:"short"}).format(new Date(iso));
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
    .select("id,customer_name,customer_email,starts_at,ends_at,status,reschedule_previous_starts_at,reschedule_previous_ends_at,reschedule_response,deposit_amount_cents,deposit_received_at,deposit_reported_sent_at,preferred_language,services(name_en,name_fr)")
    .eq("id",current.id).single();
  if(error||!data){console.error("telegram-booking: appointment lookup failed",{code:error?.code,message:error?.message});return new Response("Appointment lookup failed",{status:500});}
  const serviceInfo=Array.isArray(data.services)?data.services[0]:(data.services as {name_en?:string;name_fr?:string}|null);
  const serviceName=serviceInfo?.name_en??"Service";
  const lang:"en"|"fr"=data.preferred_language==="fr"?"fr":"en";
  const customerService=lang==="fr"?(serviceInfo?.name_fr||serviceName):(serviceInfo?.name_en||serviceInfo?.name_fr||"Service");
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
  const depositReported=Boolean(data.deposit_reported_sent_at);
  const depositAmount=new Intl.NumberFormat("en-CA",{style:"currency",currency:"CAD"}).format((data.deposit_amount_cents??2000)/100);
  const depositLabel=depositPaid?"Received":"Not received";
  const transferEmail="xhair.dreams@gmail.com";
  // Only share the private service address with customers whose booking is
  // approved. Never include it in an initial pending request or rejection.
  const approvedLocation="12151 Place Philippe-Lebon, Montréal, QC H1E 1L6";
  const showApprovedLocation=data.status==="approved";
  const activeAppointment=data.status==="pending"||data.status==="approved";
  const paymentInstructions=activeAppointment&&!depositPaid&&!depositReported;
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
    const subjectNames:Record<string,[string,string]>={
      created:["Booking request received","Demande de réservation reçue"],
      approved:["Appointment approved","Rendez-vous approuvé"],
      declined:["Appointment declined","Rendez-vous refusé"],
      cancelled:["Appointment cancelled","Rendez-vous annulé"],
      rescheduled:["Your appointment time has changed","Modification de votre rendez-vous"],
      reschedule_confirmed:["New appointment time confirmed","Nouvel horaire confirmé"],
      reschedule_needs_contact:["We received your scheduling concern","Réponse à votre proposition d’horaire"],
      deposit_received:["Deposit received","Dépôt reçu"],
      deposit_unconfirmed:["Deposit status corrected","Statut du dépôt corrigé"]
    };
    const subject="Hair by Lynna — "+(subjectNames[event]??["Appointment update","Mise à jour du rendez-vous"])[lang==="fr"?1:0];
    const reference=shortRef(data.id,data.starts_at);
    const privateLink="https://hair-by-lynna.pages.dev/?booking="+encodeURIComponent(data.id)+"&ref="+encodeURIComponent(reference)+"#booking-status";
    const reportLink=privateLink.replace("#booking-status","&deposit=sent#booking-status");
    const when=monTime(data.starts_at,lang);
    const previousWhen=data.reschedule_previous_starts_at?monTime(data.reschedule_previous_starts_at,lang):null;
    const reserved=reservedMinutes>0?[
      Math.floor(reservedMinutes/60)?Math.floor(reservedMinutes/60)+(lang==="fr"?" h":" hr"+(Math.floor(reservedMinutes/60)===1?"":"s")):"",
      reservedMinutes%60?(reservedMinutes%60)+" min":""
    ].filter(Boolean).join(" "):null;
    const copy=lang==="fr"?{
      hello:"Bonjour",service:"Coiffure",previous:"Ancienne date et heure",newTime:"Nouvelle date et heure proposée",time:"Date et heure",duration:"Durée estimée",status:"Statut",
      location:"Adresse du rendez-vous",deposit:"Dépôt",received:"Reçu",unpaid:"Non reçu",reported:"Envoi déclaré — vérification en attente",
      reference:"Référence",check:"Consulter mon rendez-vous",respond:"Répondre à la proposition",
      private:"Utilisez le courriel de réservation pour consulter le rendez-vous. Gardez votre lien privé.",
      transfer:"Envoyez le dépôt par Virement Interac",transferNote:"Inscrivez la référence de réservation dans le message. Lynna vérifiera le virement dans son compte. Si vous l'avez déjà envoyé, ne faites pas un deuxième virement.",
      reportPrompt:"Vous avez déjà envoyé votre dépôt?",reportButton:"J’ai envoyé mon dépôt",
      reportHow:"Ouvrez ce lien, saisissez votre courriel de réservation et déclarez le transfert. Lynna doit encore vérifier le virement.",
      reportedNote:"Vous avez indiqué avoir envoyé votre dépôt. Lynna vérifiera le virement Interac avant de confirmer sa réception.",
      receipt:"Votre dépôt a été reçu et sera déduit de la facture finale. Merci!",
      correction:"Le statut de votre dépôt a été corrigé. Si vous avez déjà envoyé le virement, contactez Lynna avant d'en effectuer un autre.",
      reschedule:"Veuillez consulter votre lien de réservation et indiquer si le nouvel horaire vous convient.",
      rescheduleOk:"Merci d'avoir confirmé votre nouvel horaire.",
      rescheduleNo:"Lynna a reçu votre réponse et pourra vous contacter pour trouver une autre heure. Votre rendez-vous n'a pas été annulé.",
      durationNote:"La durée est une estimation et peut varier selon vos cheveux et le style choisi.",
      statusName:({pending:"En attente",approved:"Approuvé",declined:"Refusé",cancelled:"Annulé",completed:"Terminé"} as Record<string,string>)[data.status]||data.status
    }:{
      hello:"Hi",service:"Service",previous:"Previous date & time",newTime:"New proposed date & time",time:"Date & time",duration:"Estimated duration",status:"Status",
      location:"Appointment address",deposit:"Deposit",received:"Received",unpaid:"Not received",reported:"Reported sent — awaiting verification",
      reference:"Reference",check:"Check booking status",respond:"Respond to new appointment time",
      private:"Use the email you booked with to view your status. Keep this link private.",
      transfer:"Pay deposit by Interac e-Transfer",transferNote:"Include your booking reference in the transfer message. Lynna will check her bank. If you've already sent it, please do not send a second transfer.",
      reportPrompt:"Already sent your deposit?",reportButton:"I've sent my deposit",
      reportHow:"Open the link, verify your booking email and report the transfer. Lynna still checks Interac manually.",
      reportedNote:"You reported sending your deposit. Lynna will verify your Interac payment before confirming receipt.",
      receipt:"Your deposit has been received and will be deducted from your final bill. Thank you!",
      correction:"Your deposit confirmation was corrected. If you already transferred it, contact Lynna before sending another payment.",
      reschedule:"Please open your booking-status link and confirm whether you can attend the new time.",
      rescheduleOk:"Thank you for confirming your new appointment time.",
      rescheduleNo:"Lynna received your response and can contact you to arrange another time. Your appointment has not been cancelled.",
      durationNote:"Duration is an estimate and may vary depending on your hair and style.",
      statusName:data.status
    };
    const depositState=depositPaid?copy.received:depositReported?copy.reported:copy.unpaid;
    const rows=[
      [copy.service,customerService],
      ...(rescheduled&&previousWhen?[[copy.previous,previousWhen]]:[]),
      [rescheduled?copy.newTime:copy.time,when],
      ...(reserved?[[copy.duration,reserved]]:[]),
      [copy.status,copy.statusName],
      [copy.deposit,depositAmount+" — "+depositState],
      [copy.reference,reference]
    ];
    const details=rows.map(([key,value])=>key+": "+value);
    const notes=[
      ...(event==="deposit_received"?[copy.receipt]:[]),
      ...(event==="deposit_unconfirmed"?[copy.correction]:[]),
      ...(depositReported&&!depositPaid?[copy.reportedNote]:[]),
      ...(rescheduled?[copy.reschedule]:[]),
      ...(event==="reschedule_confirmed"?[copy.rescheduleOk]:[]),
      ...(event==="reschedule_needs_contact"?[copy.rescheduleNo]:[])
    ];
    const mailText=[
      subject,"",copy.hello+" "+data.customer_name+",","",...details,
      ...(showApprovedLocation?[copy.location+": "+approvedLocation]:[]),
      "",...notes,
      ...(paymentInstructions?[copy.transfer+": "+depositAmount+" → "+transferEmail,copy.transferNote,"",
        copy.reportPrompt+" "+copy.reportButton+": "+reportLink,copy.reportHow]:[]),
      copy.check+": "+privateLink,"",copy.private,"Hair by Lynna"
    ].join("\n");
    const htmlRows=rows.map(([key,value])=>escapeHtml(key)+": <strong>"+escapeHtml(value)+"</strong><br/>").join("");
    const htmlContent=[
      '<!doctype html><html lang="'+lang+'"><body style="margin:0;padding:24px 12px;background:#120c13;font-family:Arial,Helvetica,sans-serif;color:#fbeaf3;">',
      '<div style="max-width:540px;margin:auto;background:#21121e;border:1px solid #b57495;border-radius:12px;padding:28px 22px;">',
      '<img src="https://hair-by-lynna.pages.dev/images/hair-by-lynna-logo.png" alt="Hair by Lynna" width="260" style="display:block;width:260px;max-width:100%;height:auto;margin:0 auto 22px;"/>',
      '<h2 style="font-size:19px;font-weight:600;margin:0 0 18px;">'+escapeHtml(subject)+'</h2>',
      '<p>'+escapeHtml(copy.hello)+' '+escapeHtml(data.customer_name)+',</p>',
      '<p style="line-height:1.8;">'+htmlRows+'</p>',
      ...(showApprovedLocation?['<div style="padding:15px;margin:14px 0;border:1px solid #b57495;background:#311c2b;border-radius:8px;"><strong>'+escapeHtml(copy.location)+'</strong><p>'+escapeHtml(approvedLocation)+'</p></div>']:[]),
      ...notes.map(note=>'<p style="color:#ffd6e9;line-height:1.65;">'+escapeHtml(note)+'</p>'),
      ...(paymentInstructions?[
        '<div style="padding:15px;margin:14px 0;border:1px solid #b57495;background:#311c2b;border-radius:8px;"><strong>'+escapeHtml(copy.transfer)+'</strong><p>'+escapeHtml(depositAmount)+' → <strong>'+escapeHtml(transferEmail)+'</strong></p><p>'+escapeHtml(copy.transferNote)+'</p></div>',
        '<p>'+escapeHtml(copy.reportPrompt)+'</p>',
        '<a href="'+escapeHtml(reportLink)+'" style="display:inline-block;background:#f6bdd9;color:#271323;padding:13px 17px;border-radius:7px;text-decoration:none;font-weight:bold;margin:5px 0 12px;">'+escapeHtml(copy.reportButton)+'</a>',
        '<p style="font-size:12px;color:#d3aec0;">'+escapeHtml(copy.reportHow)+'</p>'
      ]:[]),
      '<a href="'+escapeHtml(privateLink)+'" style="display:inline-block;background:#e99ec2;color:#21121e;padding:15px 22px;border-radius:7px;text-decoration:none;font-weight:bold;margin:12px 0;">'+escapeHtml(rescheduled?copy.respond:copy.check)+'</a>',
      ...(reserved?['<p style="font-size:12px;color:#d3aec0;">'+escapeHtml(copy.durationNote)+'</p>']:[]),
      '<p style="font-size:12px;color:#d3aec0;line-height:1.5;">'+escapeHtml(copy.private)+'</p>',
      '<p style="margin-top:24px;">Hair by Lynna</p></div></body></html>'
    ].join("");
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
