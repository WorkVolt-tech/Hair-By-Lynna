import React, { useState } from 'react';
import { supabase } from './lib/supabase.js';
import { bookingReference } from './lib/bookingReference.js';
import { formatDuration } from './lib/duration.js';
import './booking.css';

const isUuid = value => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value || '');
const isReference = value => /^LYN-\d{8}-\d{4}-[0-9a-f]{4}$/i.test(value || '');

export default function BookingStatus({ language, initialId = '', initialReference = '' }) {
 const fr = language === 'fr';
 const privateId = isUuid(initialId) ? initialId : '';
 const friendly = isReference(initialReference) ? initialReference.toUpperCase() : '';
 const [reference, setReference] = useState(friendly);
 const [email, setEmail] = useState('');
 const [record, setRecord] = useState(null);
 const [loading, setLoading] = useState(false);
 const [replyBusy, setReplyBusy] = useState(false);
 const [reportBusy, setReportBusy] = useState(false);
 const [error, setError] = useState('');
 const [message, setMessage] = useState('');
 const words = { pending:fr?'En attente':'Pending',approved:fr?'Approuvé':'Approved',
   declined:fr?'Refusé':'Declined',cancelled:fr?'Annulé':'Cancelled',completed:fr?'Terminé':'Completed' };

 async function check(e) {
  e.preventDefault();
  if(loading || (!privateId&&!isReference(reference.trim())))return;
  setLoading(true);setError('');setMessage('');setRecord(null);
  try {
   if(!supabase)throw Error(fr?'Service temporairement indisponible.':'Service temporarily unavailable.');
   const body=privateId?{action:'check',id:privateId,email:email.trim()}:
     {action:'send_link',reference:reference.trim().toUpperCase(),email:email.trim()};
   const {data,error:fnError}=await supabase.functions.invoke('booking-status',{body});
   if(fnError){
    let detail='';
    try{if(fnError.context?.json)detail=(await fnError.context.json())?.error||''}catch{}
    throw Error(detail||(fr?'La vérification est temporairement indisponible.':'Status checking is temporarily unavailable.'));
   }
   if(data?.error)throw Error(data.error);
   if(privateId){
    if(!data?.id)throw Error(fr?'Réponse invalide. Veuillez réessayer.':'Invalid response. Please try again.');
    setRecord(data);
   } else {
    setMessage(fr
     ? 'Si la référence et le courriel correspondent, vous recevrez bientôt un lien privé pour consulter votre statut. Vérifiez aussi vos courriels indésirables.'
     : 'If your reference and email match, you’ll receive a private status link shortly. Check your spam folder too.');
   }
  }catch(ex){setError(ex.message||'Unable to check booking.')}
  finally{setLoading(false)}
 }
 async function respondToNewTime(response) {
  if (!privateId || replyBusy || !record || record.status !== 'approved' || record.reschedule_response !== 'pending') return;
  setError('');setMessage('');setReplyBusy(true);
  try {
   const {data, error:fnError}=await supabase.functions.invoke('booking-status',{
    body:{action:'respond_reschedule',id:privateId,email:email.trim(),
     response,revision:record.reschedule_revision}
   });
   if(fnError){
    let detail='';
    try{if(fnError.context?.json)detail=(await fnError.context.json())?.error||''}catch{}
    throw Error(detail||(fr?'Votre réponse n’a pas été enregistrée. Réessayez.':'Your response was not saved. Please try again.'));
   }
   if(data?.error)throw Error(data.error);
   setRecord(data);
   setMessage(response==='confirmed'
     ?(fr?'Merci! Votre confirmation a été transmise à Lynna.':'Thank you! Lynna has received your confirmation.')
     :(fr?'Nous avons prévenu Lynna que cette heure ne vous convient pas. Elle pourra vous contacter pour en discuter.':'We have informed Lynna that this time does not work for you. She can contact you to arrange another time.'));
  }catch(ex){setError(ex.message||'Please try again.')}
  finally{setReplyBusy(false)}
 }
 async function reportDepositSent() {
  if (!privateId || !record || reportBusy || record.deposit_received_at ||
      record.deposit_reported_sent_at || !['pending','approved'].includes(record.status))return;
  setReportBusy(true);setError('');setMessage('');
  try{
   const {data,error:fnError}=await supabase.functions.invoke('booking-status',{
    body:{action:'report_deposit_sent',id:privateId,email:email.trim()}
   });
   if(fnError){
    let detail='';
    try{if(fnError.context?.json)detail=(await fnError.context.json())?.error||''}catch{}
    throw Error(detail||(fr?'Impossible d’enregistrer votre déclaration. Réessayez.':'Could not record your report. Please try again.'));
   }
   if(data?.error)throw Error(data.error);
   if(!data?.deposit_reported_sent_at&&!data?.deposit_received_at)
    throw Error(fr?'Veuillez vérifier le statut du rendez-vous et réessayer.':'Please check your booking status and try again.');
   setRecord(data);
   setMessage(fr
    ?'Merci! Votre déclaration est enregistrée. Lynna vérifiera le virement Interac avant de confirmer la réception du dépôt.'
    :'Thank you! Your report is recorded. Lynna will verify the Interac transfer before marking the deposit as received.');
  }catch(ex){setError(ex.message||(fr?'Veuillez réessayer.':'Please try again.'))}
  finally{setReportBusy(false)}
 }
 const fmt = iso => new Date(iso).toLocaleString(fr?'fr-CA':'en-CA',{dateStyle:'full',timeStyle:'short',timeZone:'America/Toronto'});
 const shownReference=record?bookingReference(record.id,record.starts_at):(privateId?friendly:reference.trim().toUpperCase());
 return <section className="customer-booking booking-status-panel" id="booking-status" aria-labelledby="booking-status-title">
  <span className="booking-status-kicker">{fr?'Votre réservation':'YOUR BOOKING'}</span>
  <h3 id="booking-status-title">{fr?'Suivre mon rendez-vous':'Check your booking status'}</h3>
  {privateId&&new URLSearchParams(window.location.search).get('deposit')==='sent'&&<p className="booking-deposit-hint" role="status">{fr
   ?'Vous avez envoyé votre dépôt? Vérifiez votre réservation ci-dessous, puis cliquez sur « J’ai envoyé mon dépôt ».'
   :'Already sent your deposit? Check your booking below, then click “I’ve sent my deposit”.'}</p>}
  <p className="booking-status-intro">{privateId
   ? (fr?'Entrez le courriel utilisé lors de votre réservation pour consulter votre statut.':'Enter the email address used for your booking to view its current status.')
   : (fr?'Entrez votre référence de réservation et votre courriel. Nous vous enverrons un lien sécurisé pour consulter votre statut.':'Enter your booking reference and email. We’ll send you a secure link to view your status.')}</p>
  {privateId&&friendly&&<div className="booking-friendly-reference booking-status-ref"><span>{fr?'Votre référence':'Your reference'}</span><strong>{shownReference}</strong></div>}
  <form className="booking-details booking-status-form" onSubmit={check}>
   {!privateId&&<label>{fr?'Référence de réservation':'Booking reference'}
     <input type="text" required autoComplete="off" spellCheck="false" inputMode="text"
      placeholder="LYN-20261029-0630-4044" pattern="LYN-[0-9]{8}-[0-9]{4}-[0-9A-Fa-f]{4}"
      maxLength={22} value={reference} onChange={e=>setReference(e.target.value.toUpperCase())}/>
   </label>}
   <label>{fr?'Courriel de réservation':'Booking email'}
    <input required type="email" maxLength={254} autoComplete="email"
      placeholder={fr?'votre@courriel.com':'you@example.com'} value={email} onChange={e=>setEmail(e.target.value)}/>
   </label>
   <button className="booking-status-submit" disabled={loading} type="submit">
    {loading?(fr?'Vérification…':'Checking…'):(fr?'Vérifier le statut':'Check status')}
   </button>
  </form>
  {!privateId&&<p className="booking-status-helper">{fr
   ? 'Pour protéger vos renseignements, le statut sera accessible seulement à partir du lien envoyé à votre courriel.'
   : 'For your privacy, your status is available only through the private link sent to your email.'}</p>}
  {message&&<p className="booking-status-result" role="status">{message}</p>}
  {error&&<p className="booking-status-error" role="alert">{error}</p>}
  {record&&<div className="booking-summary booking-status-result" role="status">
   <span className="booking-status-label">{fr?'État du rendez-vous':'Appointment status'}</span>
   <strong className="booking-status-value">{words[record.status]||record.status}</strong>
   <p>{fr?record.service_fr:record.service_en}</p>
   <p>{fmt(record.starts_at)} — {new Date(record.ends_at).toLocaleTimeString(fr?'fr-CA':'en-CA',
     {hour:'numeric',minute:'2-digit',timeZone:'America/Toronto'})}</p>
   <p className="booking-status-reference">{shownReference}</p>
   <p className="booking-status-estimate">{fr?'Durée estimée':'Estimated duration'}: <strong>{formatDuration(Math.round((new Date(record.ends_at).getTime()-new Date(record.starts_at).getTime())/60000),language)}</strong></p>
   <div className={'booking-deposit-status '+(record.deposit_received_at?'booking-deposit-paid':'booking-deposit-unpaid')}>
    <span className="booking-status-label">{fr?'Statut du dépôt':'Deposit status'}</span>
    <strong>{new Intl.NumberFormat(fr?'fr-CA':'en-CA',{style:'currency',currency:'CAD'}).format((record.deposit_amount_cents??2000)/100)} — {record.deposit_received_at?(fr?'Reçu et confirmé':'Received and confirmed'):record.deposit_reported_sent_at?(fr?'Envoi déclaré — vérification en attente':'Reported sent — awaiting verification'):(fr?'Non encore reçu':'Not yet received')}</strong>
    {record.deposit_received_at
      ?<p>{fr?'Lynna a confirmé la réception de votre dépôt. Il sera déduit du montant final.':'Lynna has confirmed receipt of your deposit. It will be deducted from your final bill.'}</p>
      :(['pending','approved'].includes(record.status)&&<>
        <p>{fr?'Envoyez votre dépôt par Virement Interac à :':'Send your deposit by Interac e-Transfer to:'}</p>
        <a className="booking-deposit-email" href="mailto:xhair.dreams@gmail.com">xhair.dreams@gmail.com</a>
        <p>{fr?'Inscrivez votre référence de réservation dans le message du virement. Lynna confirmera la réception après vérification. Si vous avez déjà payé, ne renvoyez pas un deuxième virement.':'Include your booking reference in the transfer message. Lynna will confirm after verifying the payment. If you have already paid, do not send it a second time.'}</p>
        {record.deposit_reported_sent_at
         ?<p className="booking-deposit-reported" role="status">{fr
          ?'Vous avez indiqué avoir envoyé le dépôt. Le rappel de paiement ne sera pas envoyé. Lynna doit encore vérifier le virement.'
          :'You reported sending the deposit. The payment warning will be suppressed. Lynna must still verify the transfer.'}</p>
         :record.deposit_due_at&&<button type="button" className="booking-deposit-report-button" disabled={reportBusy}
           onClick={reportDepositSent}>{reportBusy
            ?(fr?'Enregistrement…':'Saving…')
            :(fr?'J’ai envoyé mon dépôt':'I’ve sent my deposit')}</button>}
       </>)}
   </div>
   {record.status==='approved' && record.reschedule_response==='pending' && <div className="booking-reschedule-response">
    <strong className="booking-reschedule-title">{fr?'Votre horaire a été modifié':'Your appointment time has changed'}</strong>
    {record.reschedule_previous_starts_at&&<p>{fr?'Ancien horaire':'Previous time'}: <strong>{fmt(record.reschedule_previous_starts_at)}</strong></p>}
    <p>{fr?'Nouvel horaire proposé':'New proposed time'}: <strong>{fmt(record.starts_at)}</strong></p>
    <p>{fr?'Pouvez-vous vous présenter à cette nouvelle heure?':'Can you attend at the new time?'}</p>
    <div className="booking-reschedule-actions">
     <button type="button" disabled={replyBusy} onClick={()=>respondToNewTime('confirmed')}>{fr?'Confirmer la nouvelle heure':'Confirm new time'}</button>
     <button type="button" disabled={replyBusy} className="booking-reschedule-decline" onClick={()=>respondToNewTime('needs_contact')}>{fr?'Cette heure ne me convient pas':"I can't make this time"}</button>
    </div>
    <p className="booking-reschedule-hint">{fr?'Si cette heure ne vous convient pas, Lynna vous contactera pour trouver une solution. Le rendez-vous ne sera pas annulé automatiquement.':'If this time does not work, Lynna can follow up. Your appointment will not be cancelled automatically.'}</p>
   </div>}
   {record.status==='approved'&&record.reschedule_response==='confirmed'&&<p className="booking-reschedule-state">{fr?'Nouvel horaire confirmé par vous.':'You confirmed the updated time.'}</p>}
   {record.status==='approved'&&record.reschedule_response==='needs_contact'&&<p className="booking-reschedule-state">{fr?'Vous avez indiqué que cet horaire ne vous convient pas. Lynna a été informée.':'You indicated that the new time does not work for you. Lynna has been informed.'}</p>}
  </div>}
 </section>;
}
