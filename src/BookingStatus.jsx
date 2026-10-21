import React,{useState} from 'react';
import { supabase } from './lib/supabase.js';
import { bookingReference } from './lib/bookingReference.js';
import './booking.css';
export default function BookingStatus({language,initialId=''}) {
 const fr=language==='fr', [id,setId]=useState(initialId),[email,setEmail]=useState(''),[record,setRecord]=useState(null),[loading,setLoading]=useState(false),[error,setError]=useState('');
 const words={pending:fr?'En attente':'Pending',approved:fr?'Approuvé':'Approved',declined:fr?'Refusé':'Declined',cancelled:fr?'Annulé':'Cancelled'};
 async function check(e){e.preventDefault();setLoading(true);setError('');setRecord(null);
  try{
   if(!supabase)throw Error(fr?'Service indisponible.':'Service unavailable.');
   const {data,error}=await supabase.functions.invoke('booking-status',{body:{id:id.trim(),email:email.trim()}});
   if(error||!data||data.error)throw Error(data?.error|| (fr?'Impossible de vérifier.':'Unable to check your booking.'));
   setRecord(data);
  }catch(ex){setError(ex.message||'Unable to check booking.')}finally{setLoading(false)}
 }
 const fmt=(v)=>new Date(v).toLocaleString(fr?'fr-CA':'en-CA',{dateStyle:'full',timeStyle:'short',timeZone:'America/Toronto'});
 return <div className="customer-booking" id="booking-status"><h3>{fr?'Suivre votre rendez-vous':'Check your booking status'}</h3><p className="booking-notice">{fr?'Entrez le numéro de réservation sécurisé de votre lien de confirmation et le courriel utilisé lors de la réservation.':'Enter the secure booking ID from your confirmation link and the email you used to book.'}</p>
 <form className="booking-details" onSubmit={check}><label>{fr?'Identifiant de réservation':'Booking ID'}<input required value={id} onChange={e=>setId(e.target.value)} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" autoComplete="off"/></label><label>{fr?'Courriel de réservation':'Booking email'}<input required type="email" value={email} onChange={e=>setEmail(e.target.value)} autoComplete="email"/></label><button disabled={loading} type="submit">{loading?(fr?'Recherche…':'Checking…'):(fr?'Vérifier le statut':'Check status')}</button></form>
 {error&&<p className="booking-notice" role="alert">{error}</p>}
 {record&&<div className="booking-summary" role="status"><strong>{words[record.status]||record.status}</strong><p>{fr?record.service_fr:record.service_en}</p><p>{fmt(record.starts_at)} — {new Date(record.ends_at).toLocaleTimeString(fr?'fr-CA':'en-CA',{hour:'numeric',minute:'2-digit',timeZone:'America/Toronto'})}</p><p>{bookingReference(record.id,record.starts_at)}</p></div>}
 </div>
}
