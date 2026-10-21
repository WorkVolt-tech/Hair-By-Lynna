import React, { useState } from 'react';
import { supabase } from './lib/supabase.js';
import { bookingReference } from './lib/bookingReference.js';
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
 const [error, setError] = useState('');
 const [message, setMessage] = useState('');
 const words = { pending:fr?'En attente':'Pending',approved:fr?'Approuvé':'Approved',
   declined:fr?'Refusé':'Declined',cancelled:fr?'Annulé':'Cancelled' };

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
 const fmt = iso => new Date(iso).toLocaleString(fr?'fr-CA':'en-CA',{dateStyle:'full',timeStyle:'short',timeZone:'America/Toronto'});
 const shownReference=record?bookingReference(record.id,record.starts_at):(privateId?friendly:reference.trim().toUpperCase());
 return <section className="customer-booking booking-status-panel" id="booking-status" aria-labelledby="booking-status-title">
  <span className="booking-status-kicker">{fr?'Votre réservation':'YOUR BOOKING'}</span>
  <h3 id="booking-status-title">{fr?'Suivre mon rendez-vous':'Check your booking status'}</h3>
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
  </div>}
 </section>;
}
