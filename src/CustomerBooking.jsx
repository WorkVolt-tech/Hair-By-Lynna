import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from './lib/supabase.js';
import './booking.css';
import { bookingReference } from './lib/bookingReference.js';
const pad=n=>String(n).padStart(2,'0');
const dateKey=d=>[d.getFullYear(),pad(d.getMonth()+1),pad(d.getDate())].join('-');
const dateObj=s=>{const [y,m,d]=s.split('-').map(Number);return new Date(y,m-1,d,12)};
const mins=s=>{const [h,m]=s.split(':').map(Number);return h*60+m};
const clock=(n,lang)=>new Date(2026,0,1,Math.floor(n/60),n%60).toLocaleTimeString(lang==='fr'?'fr-CA':'en-CA',{hour:'numeric',minute:'2-digit'});
function monthCells(month){const [y,m]=month.split('-').map(Number);const first=new Date(y,m-1,1);const lead=(first.getDay()+6)%7;const days=new Date(y,m,0).getDate();return Array.from({length:Math.ceil((days+lead)/7)*7},(_,i)=>{const n=i-lead+1;return n>=1&&n<=days?dateKey(new Date(y,m-1,n)):null})}
export default function CustomerBooking({language}){
 const fr=language==='fr';
 const [services,setServices]=useState([]),[windows,setWindows]=useState([]),[error,setError]=useState(''),[loading,setLoading]=useState(true);
 const [serviceId,setServiceId]=useState(''),[day,setDay]=useState(''),[time,setTime]=useState(null);
 const [liveSlots,setLiveSlots]=useState([]),[slotsBusy,setSlotsBusy]=useState(false),[slotsReady,setSlotsReady]=useState(false);
 const [clientName,setClientName]=useState(''),[clientEmail,setClientEmail]=useState(''),[clientPhone,setClientPhone]=useState(''),[agreed,setAgreed]=useState(false),[sending,setSending]=useState(false),[success,setSuccess]=useState('');
 const [month,setMonth]=useState(()=>{const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Toronto',year:'numeric',month:'2-digit'}).formatToParts(new Date());return parts.find(p=>p.type==='year').value+'-'+parts.find(p=>p.type==='month').value});
 useEffect(()=>{
  let live=true,requesting=false;
  async function load(initial=false){
   if(!supabase){if(live){setError(fr?'La réservation est temporairement indisponible.':'Booking is temporarily unavailable.');setLoading(false)}return}
   if(requesting)return;
   requesting=true;
   try{
    const [s,w]=await Promise.all([supabase.from('services').select('id,name_en,name_fr,duration_minutes,price_cents').eq('active',true).order('sort_order'),supabase.rpc('public_booking_windows')]);
    if(!live)return;
    if(s.error||w.error){if(initial)setError(fr?'Les disponibilités ne peuvent pas être chargées pour le moment.':'Availability cannot be loaded right now.')}
    else{setServices(s.data||[]);setWindows(w.data||[]);setError('')}
   }finally{requesting=false;if(live)setLoading(false)}
  }
  function refreshOnReturn(){if(document.visibilityState==='visible')load()}
  load(true);
  window.addEventListener('focus',refreshOnReturn);
  document.addEventListener('visibilitychange',refreshOnReturn);
  const timer=setInterval(()=>{if(document.visibilityState==='visible')load()},15000);
  return()=>{live=false;clearInterval(timer);window.removeEventListener('focus',refreshOnReturn);document.removeEventListener('visibilitychange',refreshOnReturn)};
 },[language]);
 const todayMontreal=useMemo(()=>{const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Toronto',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());return ['year','month','day'].map(type=>parts.find(p=>p.type===type).value).join('-')},[]);
 const service=services.find(s=>s.id===serviceId);
 const slotsByDay=useMemo(()=>{const result={};if(!service)return result;
 for(const w of windows){const begin=mins(w.starts),end=mins(w.ends);if(!result[w.day])result[w.day]=[];
   for(let t=Math.ceil(begin/30)*30;t+service.duration_minutes<=end;t+=30){if(!result[w.day].includes(t))result[w.day].push(t)}
 }return result},[service,windows]);
 useEffect(()=>{let live=true;setLiveSlots([]);setSlotsReady(false);if(!supabase||!serviceId||!day)return;
 setSlotsBusy(true);
 supabase.rpc('public_booking_slots',{p_service_id:serviceId,p_day:day}).then(({data,error})=>{
  if(!live)return;
  if(!error){setLiveSlots([...new Set((data||[]).map(x=>mins(x.slot_time)))].sort((a,b)=>a-b));setSlotsReady(true)}
  else setError(fr?'Les heures exactes ne sont pas encore disponibles.':'Exact appointment times are not available yet.');
 }).finally(()=>{if(live)setSlotsBusy(false)});
 return()=>{live=false};
 },[serviceId,day,language]);
 const cells=useMemo(()=>monthCells(month),[month]);
 function changeMonth(direction){const [y,m]=month.split('-').map(Number);const next=new Date(y,m-1+direction,1);setMonth(dateKey(next).slice(0,7))}
 const monthDate=dateObj(month+'-01');
 function pickService(id){setError('');setServiceId(id);setDay('');setTime(null)}
 function pickDay(d){if(d<todayMontreal||!slotsByDay[d]?.length)return;setError('');setDay(d);setTime(null)}
 async function submitRequest(e){
 e.preventDefault();if(!supabase||!service||!day||time===null||!agreed||sending)return;
 setSending(true);setError('');setSuccess('');
 const {data,error}=await supabase.rpc('request_appointment',{p_service_id:serviceId,p_day:day,p_time:pad(Math.floor(time/60))+':'+pad(time%60)+':00',p_name:clientName.trim(),p_email:clientEmail.trim(),p_phone:clientPhone.trim(),p_policy_accepted:agreed});
 if(error){const code=error.message||'';setError(code.includes('TIME_UNAVAILABLE')?(fr?'Cette heure vient de devenir indisponible. Choisissez une autre heure.':'That time is no longer available. Please choose another.'):code.includes('RATE_LIMITED')?(fr?'Trop de demandes récentes. Réessayez plus tard.':'Too many recent requests. Please try again later.'):fr?"Impossible d'envoyer votre demande. Vérifiez vos renseignements et réessayez.":'Unable to submit. Check your details and try again.');}
 else{setSuccess(data);setTime(null);setAgreed(false);setLiveSlots(v=>v.filter(x=>x!==time));}
 setSending(false);
 }
 const prettyDate=day?dateObj(day).toLocaleDateString(fr?'fr-CA':'en-CA',{weekday:'long',month:'long',day:'numeric',year:'numeric'}):'';
 return <div className="customer-booking">
  <h3>{fr?'Choisissez votre coiffure':'Choose your hairstyle'}</h3>
  {loading?<p>{fr?'Chargement…':'Loading…'}</p>:error?<p role="status" className="booking-notice">{error}</p>:null}
  {!loading&&!services.length&&<p className="booking-notice">{fr?"Les services et les horaires seront affichés ici dès qu'ils seront publiés.":"Services and available times will appear here when Lynna publishes them."}</p>}
  <label className="booking-service-picker">{fr?'Hairstyle / Service':'Hairstyle / Service'}<select value={serviceId} onChange={e=>pickService(e.target.value)}><option value="">{fr?'— Choisissez une coiffure —':'— Select a hairstyle —'}</option>{services.map(s=><option key={s.id} value={s.id}>{fr?s.name_fr:s.name_en} · {s.duration_minutes} min · {(s.price_cents/100).toFixed(2)} $</option>)}</select></label>{services.length===1&&<p className="booking-notice">{fr?"Une seule coiffure est disponible actuellement. Lynna peut activer les autres dans Admin → Services.":"Only one hairstyle is currently available for booking. Lynna can enable other styles in Admin → Services."}</p>}{service&&<div className="booking-service-selection"><strong>{fr?service.name_fr:service.name_en}</strong><span>{service.duration_minutes} min · {(service.price_cents/100).toLocaleString(fr?'fr-CA':'en-CA',{style:'currency',currency:'CAD'})}</span></div>}
  {service&&<><h3>{fr?'Choisissez une date':'Choose a date'}</h3>
  <div className="booking-month"><button type="button" onClick={()=>changeMonth(-1)} aria-label={fr?'Mois précédent':'Previous month'}>‹</button><strong>{monthDate.toLocaleDateString(fr?'fr-CA':'en-CA',{month:'long',year:'numeric'})}</strong><button type="button" onClick={()=>changeMonth(1)} aria-label={fr?'Mois suivant':'Next month'}>›</button></div>
  <div className="booking-days">{(fr?['L','M','M','J','V','S','D']:['M','T','W','T','F','S','S']).map((d,i)=><span className="booking-weekday" key={i}>{d}</span>)}{cells.map((d,i)=>d?<button type="button" key={d} className={day===d?'selected':''} disabled={d<todayMontreal||!slotsByDay[d]?.length} onClick={()=>pickDay(d)} aria-label={d}>{Number(d.slice(-2))}</button>:<span key={'blank'+i}/>)}</div>
  {day&&<><h3>{fr?'Heures possibles':'Possible times'}</h3><p className="booking-date-label">{prettyDate} · {service.duration_minutes} min</p>{slotsBusy&&<p className="booking-notice">{fr?'Vérification des horaires…':'Checking actual availability…'}</p>}{slotsReady&&liveSlots.length===0&&<p className="booking-notice" role="status">{fr?'Aucune heure disponible pour cette date et cette coiffure. Choisissez une autre date.':'No available times for this date and hairstyle. Please choose another date.'}</p>}<div className="booking-time-grid">{(slotsReady?liveSlots:[]).map(t=><button type="button" key={t} className={time===t?'selected':''} onClick={()=>setTime(t)}>{clock(t,language)}</button>)}</div></>}
  {day&&time!==null&&<div className="booking-summary"><strong>{fr?'Votre sélection':'Your selection'}</strong><p>{fr?service.name_fr:service.name_en}</p><p>{prettyDate} · {clock(time,language)}</p><form className="booking-details" onSubmit={submitRequest}><label>{fr?'Nom complet':'Full name'}<input required maxLength={100} minLength={2} autoComplete="name" value={clientName} onChange={e=>setClientName(e.target.value)}/></label><label>{fr?'Courriel':'Email'}<input type="email" required maxLength={254} autoComplete="email" value={clientEmail} onChange={e=>setClientEmail(e.target.value)}/></label><label>{fr?'Téléphone (facultatif)':'Phone (optional)'}<input type="tel" maxLength={35} autoComplete="tel" value={clientPhone} onChange={e=>setClientPhone(e.target.value)}/></label><label className="booking-agreement"><input type="checkbox" required checked={agreed} onChange={e=>setAgreed(e.target.checked)}/><span>{fr?"J'ai lu et j'accepte les politiques de réservation et d'annulation.":"I've read and agree to the booking and cancellation policies."}</span></label><p className="booking-notice">{fr?"Votre demande sera en attente d'approbation. Aucun courriel automatique n'est encore envoyé.":"Your request will be pending approval. Automatic emails are not active yet."}</p><button type="submit" disabled={sending||!agreed}>{sending?(fr?'Envoi…':'Sending…'):(fr?'Demander le rendez-vous':'Request appointment')}</button></form></div>}
  {success&&<div className="booking-summary" role="status"><strong>{fr?'Demande reçue':'Request received'}</strong><p>{fr?"Votre demande est enregistrée et en attente d'approbation par Lynna.":"Your appointment request is saved and awaiting Lynna’s approval."}</p><p className="booking-notice">{fr?"Notez votre référence. Les notifications automatiques ne sont pas encore activées.":"Save your reference. Automatic notifications aren't enabled yet."}</p><div className="booking-friendly-reference"><span>{fr?'Votre référence':'Your reference'}</span><strong>{bookingReference(success)}</strong></div></div>}
  </>}
  <p className="booking-footnote">{fr?"Les horaires indiqués proviennent des disponibilités publiées par Lynna et peuvent changer. Une demande soumise réserve temporairement cette heure jusqu’à la décision de Lynna.":"Displayed times are based on Lynna’s published schedule and may change. Submitted requests hold the selected time until Lynna decides."}</p>
 </div>
}
