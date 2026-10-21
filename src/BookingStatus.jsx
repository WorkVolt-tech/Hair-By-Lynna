import React, { useState } from 'react';
import { supabase } from './lib/supabase.js';
import { bookingReference } from './lib/bookingReference.js';
import './booking.css';

const isUuid = (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value || '');
const isReference = (value) => /^LYN-\d{8}-\d{4}-[0-9A-F]{4}$/i.test(value || '');

export default function BookingStatus({ language, initialId = '', initialReference = '' }) {
 const fr = language === 'fr';
 // The private UUID from the confirmation URL stays out of the visible form.
 // The customer sees the friendly LYN reference instead.
 const privateId = isUuid(initialId) ? initialId : '';
 const friendly = isReference(initialReference) ? initialReference.toUpperCase() : '';
 const [email, setEmail] = useState('');
 const [record, setRecord] = useState(null);
 const [loading, setLoading] = useState(false);
 const [error, setError] = useState('');
 const words = {
  pending: fr ? 'En attente' : 'Pending',
  approved: fr ? 'Approuvé' : 'Approved',
  declined: fr ? 'Refusé' : 'Declined',
  cancelled: fr ? 'Annulé' : 'Cancelled'
 };
 async function check(e) {
  e.preventDefault();
  if (!privateId || loading) return;
  setLoading(true); setError(''); setRecord(null);
  try {
   if (!supabase) throw new Error(fr ? 'Service indisponible pour le moment.' : 'Service temporarily unavailable.');
   const { data, error: fnError } = await supabase.functions.invoke('booking-status', { body: { id: privateId, email: email.trim() } });
   if (fnError) {
    let message = '';
    try { if (fnError.context?.json) message = (await fnError.context.json())?.error || ''; } catch {}
    const status = fnError.context?.status;
    if (status === 404 && !message) message = fr ? 'La vérification des réservations n’est pas encore disponible. Veuillez réessayer plus tard.' : 'Booking status checking is not active yet. Please try again later.';
    throw new Error(message || (fr ? 'Vérification impossible. Veuillez réessayer plus tard.' : 'Could not check your booking. Please try again later.'));
   }
   if (!data || data.error) throw new Error(data?.error || 'Booking unavailable.');
   setRecord(data);
  } catch (ex) {
   setError(ex.message || (fr ? 'Vérification impossible.' : 'Unable to check booking.'));
  } finally { setLoading(false); }
 }
 const fmt = (iso) => new Date(iso).toLocaleString(fr ? 'fr-CA' : 'en-CA', {
  dateStyle: 'full', timeStyle: 'short', timeZone: 'America/Toronto'
 });
 const actualReference = record ? bookingReference(record.id, record.starts_at) : friendly;
 return <div className="customer-booking booking-status-panel" id="booking-status">
  <h3>{fr ? 'Suivre votre rendez-vous' : 'Check your booking status'}</h3>
  {privateId ? <>
   <p className="booking-notice">{fr ? 'Votre lien de réservation sécurisé est prêt. Pour consulter votre statut, entrez le courriel utilisé lors de la réservation.' : 'Your secure booking link is ready. Enter the email address you booked with to check its status.'}</p>
   {actualReference && <div className="booking-friendly-reference"><span>{fr ? 'Référence du rendez-vous' : 'Booking reference'}</span><strong>{actualReference}</strong></div>}
   <form className="booking-details" onSubmit={check}>
    <label>{fr ? 'Courriel de réservation' : 'Booking email'}<input required type="email" maxLength={254} autoComplete="email" value={email} onChange={e => setEmail(e.target.value)}/></label>
    <button disabled={loading} type="submit">{loading ? (fr ? 'Recherche…' : 'Checking…') : (fr ? 'Vérifier le statut' : 'Check status')}</button>
   </form>
  </> : <p className="booking-notice" role="status">{fr ? 'Pour protéger vos renseignements, ouvrez le lien « Vérifier le statut » dans votre courriel de confirmation. Votre référence LYN seule ne permet pas d’afficher un rendez-vous.' : 'For your privacy, open the “Check booking status” link in your confirmation email. The LYN reference alone cannot unlock a private appointment.'}</p>}
  {error && <p className="booking-notice" role="alert">{error}</p>}
  {record && <div className="booking-summary" role="status">
   <strong>{words[record.status] || record.status}</strong>
   <p>{fr ? record.service_fr : record.service_en}</p>
   <p>{fmt(record.starts_at)} — {new Date(record.ends_at).toLocaleTimeString(fr ? 'fr-CA' : 'en-CA', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Toronto' })}</p>
   <p>{actualReference}</p>
  </div>}
 </div>;
}
