// Hair by Lynna — deposit deadline notifier. Deploy as "deposit-deadlines".
// Schedule every minute using pg_cron/pg_net and a dedicated deposit-alert secret.
// Set Verify JWT OFF; this function checks X-Deposit-Secret before querying.
// Customers can REPORT sending money but only Lynna verifies actual receipt.
// Never automatically cancel bookings or set deposit_received_at.
import { createClient } from "npm:@supabase/supabase-js@2";

const website="https://hair-by-lynna.pages.dev";
const logo=website+"/images/hair-by-lynna-logo.png";
const escapeHtml=(value:unknown)=>String(value??"")
 .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
 .replace(/"/g,"&quot;").replace(/'/g,"&#39;");
function sameSecret(a:string,b:string):boolean{
 const x=new TextEncoder().encode(a),y=new TextEncoder().encode(b);
 if(x.length!==y.length)return false;
 let diff=0;
 for(let i=0;i<x.length;i++)diff|=x[i]^y[i];
 return diff===0;
}
function montreal(value:string,lang:"en"|"fr"="en"){
 return new Intl.DateTimeFormat(lang==="fr"?"fr-CA":"en-CA",{
  timeZone:"America/Toronto",dateStyle:"full",timeStyle:"short"
 }).format(new Date(value));
}
function bookingReference(id:string,date:string){
 const parts=new Intl.DateTimeFormat("en-CA",{
  timeZone:"America/Toronto",year:"numeric",month:"2-digit",day:"2-digit",
  hour:"2-digit",minute:"2-digit",hourCycle:"h23"
 }).formatToParts(new Date(date));
 const v=(type:string)=>parts.find(p=>p.type===type)?.value||"";
 return "LYN-"+v("year")+v("month")+v("day")+"-"+v("hour")+v("minute")
  +"-"+id.replace(/-/g,"").slice(0,4).toUpperCase();
}
type Alert={notice_id:number;appointment_id:string;notice_kind:string;due_at:string};
type Booking={
 id:string;customer_name:string;customer_email:string;status:string;
 starts_at:string;deposit_due_at:string|null;deposit_received_at:string|null;
 deposit_reported_sent_at:string|null;deposit_amount_cents:number|null;
};
async function sendWarning(a:Booking,brevoKey:string,sender:string){
 const amount=new Intl.NumberFormat("en-CA",{style:"currency",currency:"CAD"}).format((a.deposit_amount_cents??2000)/100);
 const ref=bookingReference(a.id,a.starts_at);
 const url=website+"/?booking="+encodeURIComponent(a.id)+"&ref="+encodeURIComponent(ref)+"&deposit=sent#booking-status";
 const deadlineEn=montreal(a.deposit_due_at!,"en"),deadlineFr=montreal(a.deposit_due_at!,"fr");
 const subject="Hair by Lynna — Deposit due soon / Dépôt à envoyer";
 const plain=[
  "Hair by Lynna — Deposit reminder",
  "Hi "+a.customer_name+",",
  "Your "+amount+" Interac deposit is due in approximately 5 minutes.",
  "If Lynna cannot verify the deposit after the deadline, your booking may be manually cancelled and the slot released.",
  "Deadline (Montréal): "+deadlineEn,
  "If you already sent it, do not send another transfer. Report it here: "+url,
  "Enter the email used for your booking, then select 'I've sent my deposit'.",
  "Lynna will verify your Interac transfer before marking it received.",
  "Booking reference: "+ref,
  "",
  "Hair by Lynna — Rappel de dépôt",
  "Bonjour "+a.customer_name+",",
  "Votre dépôt Interac de "+amount+" doit être envoyé dans environ 5 minutes.",
  "Si Lynna ne peut pas vérifier le dépôt après l'échéance, la demande pourrait être annulée manuellement et le créneau libéré.",
  "Date limite (Montréal) : "+deadlineFr,
  "Si vous l'avez déjà envoyé, ne faites pas un deuxième virement.",
  "Déclarez l'envoi ici : "+url,
  "Entrez le courriel de réservation, puis cliquez sur « J'ai envoyé mon dépôt ».",
  "Lynna doit vérifier le virement avant de confirmer sa réception."
 ].join("\n");
 const html=`<!doctype html><html><body style="margin:0;padding:22px 12px;background:#120c13;color:#f9e8f2;font-family:Arial,sans-serif;">
 <div style="margin:auto;max-width:540px;padding:27px 23px;border-radius:12px;background:#22121e;border:1px solid #bc7c9f;">
 <img src="${logo}" alt="Hair by Lynna" width="240" style="max-width:100%;height:auto;display:block;margin:0 auto 18px;"/>
 <h2 style="color:#ffd3e8;font-size:21px;">Deposit due in 5 minutes / Dépôt dans 5 minutes</h2>
 <p>Hello ${escapeHtml(a.customer_name)},</p>
 <p>Your <strong>${escapeHtml(amount)}</strong> Interac deposit deadline is approaching.</p>
 <p style="color:#ffd1df;">If the deposit cannot be verified after the deadline, Lynna may cancel the request and release the appointment slot.</p>
 <p style="color:#ffd1df;">Si le dépôt ne peut pas être vérifié après l'échéance, Lynna pourrait annuler la demande et libérer le créneau.</p>
 <p><strong>Deadline:</strong> ${escapeHtml(deadlineEn)}<br/>
 <strong>Date limite :</strong> ${escapeHtml(deadlineFr)}</p>
 <p>If you already sent the payment, do not send it again. / Si vous avez déjà envoyé le dépôt, ne faites pas un deuxième virement.</p>
 <a href="${escapeHtml(url)}" style="display:inline-block;background:#f0aeca;color:#25111c;border-radius:6px;padding:14px 18px;text-decoration:none;font-weight:bold;">I've sent my deposit / J'ai envoyé mon dépôt</a>
 <p style="font-size:12px;line-height:1.65;">Open the link and verify your booking email, then click the deposit-sent button. / Ouvrez le lien, vérifiez votre courriel et déclarez l'envoi du dépôt.</p>
 <p style="font-size:12px;color:#ddb9cb;">Lynna must verify the Interac transfer before confirming receipt. / Lynna doit vérifier le virement avant de confirmer la réception.</p>
 <p>Reference / Référence : ${escapeHtml(ref)}</p>
 </div></body></html>`;
 const r=await fetch("https://api.brevo.com/v3/smtp/email",{
  method:"POST",headers:{"Content-Type":"application/json","accept":"application/json","api-key":brevoKey},
  body:JSON.stringify({
   sender:{name:"Hair by Lynna",email:sender},
   replyTo:{name:"Lynna",email:"xhair.dreams@gmail.com"},
   to:[{name:a.customer_name,email:a.customer_email}],subject,textContent:plain,htmlContent:html
  })
 });
 if(!r.ok)throw Error("Brevo HTTP "+r.status);
}
async function sendOwnerAlert(a:Booking,kind:string,token:string,chat:string){
 const ref=bookingReference(a.id,a.starts_at);
 const claimed=Boolean(a.deposit_reported_sent_at);
 const heading=kind==="owner_reported"?"💗 Customer says deposit SENT — CHECK INTERAC":
   "⏰ Deposit deadline PASSED — review before cancelling";
 const lines=[
  heading,"",
  "Client: "+a.customer_name,
  "Reference: "+ref,
  "Appointment: "+montreal(a.starts_at),
  "Deposit deadline: "+montreal(a.deposit_due_at!),
  "Customer reported sending: "+(claimed?"YES — bank verification needed":"NO"),
  ...(claimed?["Reported on: "+montreal(a.deposit_reported_sent_at!)]:[]),
  "",
  "ACTION: Check Lynna's Interac/bank account.",
  "If received, select Confirm deposit received in Admin.",
  ...(kind==="owner_overdue"?["If NOT received, review and manually cancel the request."]:[]),
  "This alert does NOT automatically cancel the booking.",
  "Admin: "+website+"/admin"
 ];
 const r=await fetch("https://api.telegram.org/bot"+token+"/sendMessage",{
  method:"POST",headers:{"Content-Type":"application/json"},
  body:JSON.stringify({chat_id:chat,text:lines.join("\n"),disable_web_page_preview:true})
 });
 if(!r.ok)throw Error("Telegram HTTP "+r.status);
}

Deno.serve(async(request)=>{
 if(request.method!=="POST")return new Response("Method not allowed",{status:405});
 const expected=Deno.env.get("DEPOSIT_DEADLINES_SECRET")||"";
 const supplied=request.headers.get("X-Deposit-Secret")||"";
 if(expected.length<24||!sameSecret(supplied,expected))
  return new Response("Unauthorized",{status:401});
 const url=Deno.env.get("SUPABASE_URL"),key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
 const brevoKey=Deno.env.get("BREVO_API_KEY"),sender=Deno.env.get("BOOKING_EMAIL_FROM");
 const telegramToken=Deno.env.get("TELEGRAM_BOT_TOKEN"),telegramChat=Deno.env.get("TELEGRAM_CHAT_ID");
 if(!url||!key||!brevoKey||!sender||!telegramToken||!telegramChat){
  console.error("deposit-deadlines: missing configuration");
  return new Response("Not configured",{status:503});
 }
 const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:claimed,error:claimError}=await db.rpc("claim_due_deposit_deadline_alerts",{p_limit:30});
 if(claimError){
  console.error("deposit-deadlines: claim error",claimError.code);
  return new Response("Cannot claim alerts",{status:503});
 }
 let sent=0,skipped=0,failed=0;
 for(const item of (claimed||[]) as Alert[]){
  let outcome:"sent"|"failed"|"skipped"="failed";
  let errorMessage:string|null=null;
  try{
   const {data:booking,error:fetchError}=await db.from("appointments")
    .select("id,customer_name,customer_email,status,starts_at,deposit_due_at,deposit_received_at,deposit_reported_sent_at,deposit_amount_cents")
    .eq("id",item.appointment_id).maybeSingle();
   if(fetchError)throw Error("Booking lookup failed: "+fetchError.code);
   const a=booking as Booking|null;
   if(!a||!["pending","approved"].includes(a.status)||a.deposit_received_at||
      !a.deposit_due_at||new Date(a.starts_at).getTime()<=Date.now()||
      (item.notice_kind==="customer_5min"&&(
        a.deposit_reported_sent_at||Date.now()>=new Date(a.deposit_due_at).getTime()))){
    outcome="skipped";
   }else if(item.notice_kind==="customer_5min"){
    await sendWarning(a,brevoKey,sender!);
    outcome="sent";
   }else if(item.notice_kind==="owner_reported"||item.notice_kind==="owner_overdue"){
    await sendOwnerAlert(a,item.notice_kind,telegramToken!,telegramChat!);
    outcome="sent";
   }else outcome="skipped";
  }catch(e){errorMessage=String((e as Error)?.message||"Delivery failed").slice(0,150)}
  try{
   const {error:finishError}=await db.rpc("finish_deposit_deadline_alert",{
    p_notice_id:item.notice_id,p_outcome:outcome,p_error:errorMessage
   });
   if(finishError)throw Error(finishError.code);
   if(outcome==="sent")sent++;
   else if(outcome==="skipped")skipped++;
   else failed++;
  }catch(e){
   failed++;
   console.error("deposit-deadlines: unable to finish alert",item.notice_id,String(e));
  }
 }
 return new Response(JSON.stringify({sent,skipped,failed}),{
  headers:{"Content-Type":"application/json","Cache-Control":"no-store"},status:200
 });
});
