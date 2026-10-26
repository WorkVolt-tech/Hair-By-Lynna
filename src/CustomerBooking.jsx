import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from './lib/supabase.js';
import './booking.css';
import { bookingReference } from './lib/bookingReference.js';
import { formatDuration } from './lib/duration.js';
const pad=n=>String(n).padStart(2,'0');
const dateKey=d=>[d.getFullYear(),pad(d.getMonth()+1),pad(d.getDate())].join('-');
const dateObj=s=>{const [y,m,d]=s.split('-').map(Number);return new Date(y,m-1,d,12)};
const mins=s=>{const [h,m]=s.split(':').map(Number);return h*60+m};
// Keep booking failures right beside Submit rather than at the top of the
// calendar (where a visitor cannot see them). Never expose raw SQL internals.
function bookingFailureMessage(error,fr){
 const message=String(error?.message||'').toUpperCase();
 const code=String(error?.code||'').toUpperCase();
 if(message.includes('DAY_FULL'))return fr
  ?'Lynna a déjà un rendez-vous réservé ce jour-là. Choisissez une autre date.'
  :'Lynna already has a booking that day. Please choose another date.';
 if(message.includes('TIME_UNAVAILABLE'))return fr
  ?'Cette heure n’est plus disponible. Veuillez en choisir une autre.'
  :'That time is no longer available. Please select another time.';
 if(message.includes('RATE_LIMITED'))return fr
  ?'Trop de demandes récentes. Réessayez plus tard ou contactez Lynna.'
  :'Too many recent requests. Please try later or contact Lynna.';
 if(message.includes('INVALID_DETAILS'))return fr
  ?'Vérifiez votre nom, courriel et téléphone, puis réessayez.'
  :'Please check your name, email and phone number, then try again.';
 if(message.includes('POLICY_REQUIRED'))return fr
  ?'Vous devez accepter les politiques avant de réserver.'
  :'Please accept the booking policies before submitting.';
 if(message.includes('REQUEST_REJECTED'))return fr
  ?'Cette demande n’a pas pu être vérifiée. Rechargez la page, puis réessayez.'
  :'Your request could not be verified. Refresh the page and try again.';
 if(code==='PGRST202'||code==='PGRST203'||code==='42883'||code==='42501')return fr
  ?'La réservation en ligne est temporairement indisponible. Rechargez la page. Si le problème persiste, contactez Lynna. (Code : '+code+')'
  :'Online booking is temporarily unavailable. Refresh this page; if the problem continues, contact Lynna. (Code: '+code+')';
 return fr
  ?'Impossible d’envoyer la demande. Réessayez ou contactez Lynna. (Code : '+(code||'RÉSEAU')+')'
  :'Unable to submit your booking. Please try again or contact Lynna. (Code: '+(code||'NETWORK')+')';
}
const clock=(n,lang)=>new Date(2026,0,1,Math.floor(n/60),n%60).toLocaleTimeString(lang==='fr'?'fr-CA':'en-CA',{hour:'numeric',minute:'2-digit'});
function monthCells(month){const [y,m]=month.split('-').map(Number);const first=new Date(y,m-1,1);const lead=first.getDay();const days=new Date(y,m,0).getDate();return Array.from({length:Math.ceil((days+lead)/7)*7},(_,i)=>{const n=i-lead+1;return n>=1&&n<=days?dateKey(new Date(y,m-1,n)):null})}
export default function CustomerBooking({language}){
 const fr=language==='fr';
 const [services,setServices]=useState([]),[windows,setWindows]=useState([]),[error,setError]=useState(''),[loading,setLoading]=useState(true);
 const [serviceId,setServiceId]=useState(''),[day,setDay]=useState(''),[time,setTime]=useState(null);
 const [liveSlots,setLiveSlots]=useState([]),[slotsBusy,setSlotsBusy]=useState(false),[slotsReady,setSlotsReady]=useState(false);
 const [slotsError,setSlotsError]=useState(''),[slotsRetry,setSlotsRetry]=useState(0);
 const [clientName,setClientName]=useState(''),[clientEmail,setClientEmail]=useState(''),[clientPhone,setClientPhone]=useState(''),[agreed,setAgreed]=useState(false),[sending,setSending]=useState(false),[success,setSuccess]=useState('');
 const [changePulse,setChangePulse]=useState(0);
 const [submitError,setSubmitError]=useState('');
 // A real customer never sees or fills this field. Naive form-filling bots
 // commonly populate it; migration 021 rejects such requests on the server.
 const [companyWebsite,setCompanyWebsite]=useState('');
 // The monthly calendar uses the same server availability rules as the time picker,
 // without exposing any appointments or customer details to public visitors.
 const [calendarAvailability,setCalendarAvailability]=useState({key:'',days:[]});
 const [calendarBusy,setCalendarBusy]=useState(false),[calendarError,setCalendarError]=useState('');
 const [calendarRefresh,setCalendarRefresh]=useState(0);
 // The existing per-day slot RPC is a compatible fallback until migration 017
 // is installed; keep windows current without restarting the calendar every 5s.
 const publishedWindowsRef=React.useRef(windows);
 publishedWindowsRef.current=windows;
 useEffect(()=>{
  if(!supabase)return;
  const channel=supabase.channel('lynna-public-booking-pulse')
   .on('postgres_changes',{event:'UPDATE',schema:'public',table:'booking_change_signal',filter:'id=eq.1'},()=>setChangePulse(n=>n+1))
   .subscribe();
  return()=>{supabase.removeChannel(channel)};
 },[]);
 const [month,setMonth]=useState(()=>{const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Toronto',year:'numeric',month:'2-digit'}).formatToParts(new Date());return parts.find(p=>p.type==='year').value+'-'+parts.find(p=>p.type==='month').value});
 useEffect(()=>{
  let live=true,requesting=false;
  async function load(initial=false){
   if(!supabase){if(live){setError(fr?'La réservation est temporairement indisponible.':'Booking is temporarily unavailable.');setLoading(false)}return}
   if(requesting)return;
   requesting=true;
   try{
    const [s,w]=await Promise.all([supabase.from('services').select('id,name_en,name_fr,description_en,description_fr,duration_minutes,price_cents').eq('active',true).order('sort_order'),supabase.rpc('public_booking_windows')]);
    if(!live)return;
    if(s.error||w.error){if(initial)setError(fr?'Les disponibilités ne peuvent pas être chargées pour le moment.':'Availability cannot be loaded right now.')}
    else{setServices(s.data||[]);setWindows(w.data||[]);setError('')}
   }finally{requesting=false;if(live)setLoading(false)}
  }
  function refreshOnReturn(){if(document.visibilityState==='visible')load()}
  load(true);
  window.addEventListener('focus',refreshOnReturn);
  document.addEventListener('visibilitychange',refreshOnReturn);
  const timer=setInterval(()=>{if(document.visibilityState==='visible')load()},5000);
  return()=>{live=false;clearInterval(timer);window.removeEventListener('focus',refreshOnReturn);document.removeEventListener('visibilitychange',refreshOnReturn)};
 },[language,changePulse]);
 const [clockNow,setClockNow]=useState(()=>Date.now());
 useEffect(()=>{const id=setInterval(()=>setClockNow(Date.now()),30000);return()=>clearInterval(id)},[]);
 const todayMontreal=useMemo(()=>{const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Toronto',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());return ['year','month','day'].map(type=>parts.find(p=>p.type===type).value).join('-')},[]);
 const minBookingTime=clockNow+24*60*60*1000;
 const calendarKey=serviceId+'|'+month;
 const calendarReady=Boolean(serviceId)&&calendarAvailability.key===calendarKey&&!calendarError;
 const bookableDays=calendarReady?calendarAvailability.days:[];
 // Fail closed: until the authoritative server check succeeds, do not offer
 // dates that may already be occupied. Existing slot RPC still validates booking.
 useEffect(()=>{
  if(!supabase||!serviceId){setCalendarBusy(false);setCalendarError('');return}
  let live=true,requesting=false,legacyNextCheck=0;
  async function refreshCalendar(force=false){
   if(!live||requesting||(!force&&Date.now()<legacyNextCheck))return;
   requesting=true;setCalendarBusy(true);
   try{
    const {data,error:rpcError}=await supabase.rpc('public_booking_calendar_days',{
     p_service_id:serviceId,p_month:month+'-01'
    });
    let dates;
    if(rpcError){
     // Migration 017 may not have been run yet. Reuse the server's already
     // installed per-day RPC; it respects one-client-per-day and conflicts.
     // Throttle this temporary multi-request fallback to once per minute.
     if(rpcError.code!=='PGRST202'&&!/could not find the function/i.test(rpcError.message||''))throw rpcError;
     const days=[...new Set(publishedWindowsRef.current
       .filter(w=>w.day?.slice(0,7)===month&&w.day>=todayMontreal)
       .map(w=>w.day))];
     const checked=await Promise.all(days.map(async d=>{
      const {data:slots,error:slotError}=await supabase.rpc('public_booking_slots',{
       p_service_id:serviceId,p_day:d
      });
      if(slotError)throw slotError;
      return slots?.length?d:null;
     }));
     dates=checked.filter(Boolean);
     legacyNextCheck=Date.now()+60000;
    }else{
     dates=(data||[]).map(x=>x.day).filter(Boolean);
     legacyNextCheck=0;
    }
    if(!live)return;
    setCalendarAvailability({key:serviceId+'|'+month,days:[...new Set(dates)]});
    setCalendarError('');
   }catch(err){
    if(live)setCalendarError(language==='fr'
      ?'Impossible de vérifier les dates disponibles pour le moment. Réessayez.'
      :'Unable to verify available dates right now. Please try again.');
   }finally{requesting=false;if(live)setCalendarBusy(false)}
  }
  function onReturn(){if(document.visibilityState==='visible')refreshCalendar(true)}
  refreshCalendar(true);
  window.addEventListener('focus',onReturn);
  document.addEventListener('visibilitychange',onReturn);
  const timer=window.setInterval(()=>{
   if(document.visibilityState==='visible')refreshCalendar();
  },15000);
  return()=>{live=false;window.clearInterval(timer);window.removeEventListener('focus',onReturn);document.removeEventListener('visibilitychange',onReturn)};
 },[serviceId,month,language,changePulse,calendarRefresh]);
 useEffect(()=>{
  if(!calendarReady||!day||day.slice(0,7)!==month)return;
  if(!bookableDays.includes(day)){setDay('');setTime(null)}
 },[calendarReady,day,month,calendarAvailability]);
 const service=services.find(s=>s.id===serviceId);
 const slotsByDay=useMemo(()=>{const result={};if(!service)return result;
 for(const w of windows){const begin=mins(w.starts),end=mins(w.ends);if(!result[w.day])result[w.day]=[];
   for(let t=Math.ceil(begin/30)*30;t+service.duration_minutes<=end;t+=30){if(!result[w.day].includes(t) && new Date(w.day+'T'+pad(Math.floor(t/60))+':'+pad(t%60)+':00').getTime()>=minBookingTime)result[w.day].push(t)}
 }return result},[service,windows,minBookingTime]);
 useEffect(()=>{
  let live=true,loadingSlots=false;
  setLiveSlots([]);setSlotsReady(false);setSlotsError('');
  if(!supabase||!serviceId||!day)return;
  async function refreshSlots(){
   if(!live||loadingSlots)return;
   loadingSlots=true;setSlotsBusy(true);
   try{
    const {data,error}=await supabase.rpc('public_booking_slots',{
     p_service_id:serviceId,p_day:day
    });
    if(!live)return;
    if(error){
     setSlotsReady(false);
     const code=String(error.code||'');
     setSlotsError(fr
      ?'Impossible de charger les heures de ce jour. Réessayez ou contactez Lynna.'+(code?' (Code : '+code+')':'')
      :'Could not load appointment times. Try again or contact Lynna.'+(code?' (Code: '+code+')':''));
    }else{
     const available=[...new Set((data||[]).map(x=>mins(x.slot_time)))].sort((a,b)=>a-b);
     setLiveSlots(available);setSlotsReady(true);setSlotsError('');
     setTime(selected=>selected!==null&&!available.includes(selected)?null:selected);
    }
   }catch(err){
    if(live){
     setSlotsReady(false);
     setSlotsError(fr
      ?'Connexion aux horaires impossible. Veuillez réessayer.'
      :'Unable to connect to appointment times. Please retry.');
    }
   }finally{loadingSlots=false;if(live)setSlotsBusy(false)}
  }
  function onReturn(){if(document.visibilityState==='visible')refreshSlots()}
  refreshSlots();
  window.addEventListener('focus',onReturn);
  document.addEventListener('visibilitychange',onReturn);
  const timer=window.setInterval(()=>{if(document.visibilityState==='visible')refreshSlots()},5000);
  return()=>{live=false;clearInterval(timer);window.removeEventListener('focus',onReturn);document.removeEventListener('visibilitychange',onReturn)};
 },[serviceId,day,language,changePulse,slotsRetry]);
 const cells=useMemo(()=>monthCells(month),[month]);
 function changeMonth(direction){
  const [y,m]=month.split('-').map(Number);const next=new Date(y,m-1+direction,1);
  setMonth(dateKey(next).slice(0,7));setDay('');setTime(null);setSubmitError('');
 }
 const todayHint=fr
  ?'Seules les dates avec au moins une heure réservable peuvent être sélectionnées. Les journées complètes sont désactivées, notamment si Lynna accepte un seul client par jour.'
  :'Only dates with at least one bookable time can be selected. Fully booked days are disabled, including when Lynna allows one client per day.';
 const monthDate=dateObj(month+'-01');
 function pickService(id){setError('');setSubmitError('');setServiceId(id);setDay('');setTime(null)}
 function pickDay(d){
  if(d<todayMontreal||!calendarReady||!bookableDays.includes(d))return;
  setError('');setSubmitError('');setDay(d);setTime(null);
 }
 async function submitRequest(e){
  e.preventDefault();
  if(!supabase||!service||!day||time===null||!agreed||sending)return;
  setSending(true);setSubmitError('');setSuccess('');
  const bookingPayload={
   p_service_id:serviceId,p_day:day,
   p_time:pad(Math.floor(time/60))+':'+pad(time%60)+':00',
   p_name:clientName.trim(),p_email:clientEmail.trim(),p_phone:clientPhone.trim(),
   p_policy_accepted:agreed
  };
  try{
   let result=await supabase.rpc('request_appointment',{
    ...bookingPayload,p_company_website:companyWebsite
   });
   // This compatibility fallback works only before SQL 021 is installed;
   // NEVER retry a filled honeypot through the legacy endpoint.
   if(result.error?.code==='PGRST202'&&companyWebsite===''){
    result=await supabase.rpc('request_appointment',bookingPayload);
   }
   if(result.error){
    const message=String(result.error.message||'');
    if(message.includes('TIME_UNAVAILABLE')||message.includes('DAY_FULL')){
     setCalendarRefresh(n=>n+1);
    }
    setSubmitError(bookingFailureMessage(result.error,fr));
    // Background availability polling must never erase this booking error.
    return;
   }
   if(!result.data){
    setSubmitError(bookingFailureMessage({code:'EMPTY_RESPONSE'},fr));
    return;
   }
   setSuccess({id:result.data,day,time});
   setTime(null);setAgreed(false);setCompanyWebsite('');
   setLiveSlots(previous=>previous.filter(item=>item!==time));
   setCalendarRefresh(n=>n+1);
  }catch(err){
   setSubmitError(bookingFailureMessage(err,fr));
  }finally{
   setSending(false);
  }
 }
 const successRef=success?bookingReference(success.id,success.day,pad(Math.floor(success.time/60))+':'+pad(success.time%60)):'';
 const prettyDate=day?dateObj(day).toLocaleDateString(fr?'fr-CA':'en-CA',{weekday:'long',month:'long',day:'numeric',year:'numeric'}):'';
 return <div className="customer-booking">
  <h3>{fr?'Choisissez votre coiffure':'Choose your hairstyle'}</h3>
  {loading?<p>{fr?'Chargement…':'Loading…'}</p>:error?<p role="status" className="booking-notice">{error}</p>:null}
  {!loading&&!services.length&&<p className="booking-notice">{fr?"Les services et les horaires seront affichés ici dès qu'ils seront publiés.":"Services and available times will appear here when Lynna publishes them."}</p>}
  <label className="booking-service-picker">{fr?'Hairstyle / Service':'Hairstyle / Service'}<select value={serviceId} onChange={e=>pickService(e.target.value)}><option value="">{fr?'— Choisissez une coiffure —':'— Select a hairstyle —'}</option>{services.map(s=><option key={s.id} value={s.id}>{fr?s.name_fr:s.name_en} · {formatDuration(s.duration_minutes,language)} · {(s.price_cents/100).toFixed(2)} $</option>)}</select></label>{services.length===1&&<p className="booking-notice">{fr?"Une seule coiffure est disponible actuellement. Lynna peut activer les autres dans Admin → Services.":"Only one hairstyle is currently available for booking. Lynna can enable other styles in Admin → Services."}</p>}{service&&<div className="booking-service-selection">
   <div className="booking-service-details">
    <strong>{fr?service.name_fr:service.name_en}</strong>
    {(fr?service.description_fr:service.description_en)?.trim()&&<p className="booking-service-description">{(fr?service.description_fr:service.description_en).trim()}</p>}
   </div>
   <span>{formatDuration(service.duration_minutes,language)} · {(service.price_cents/100).toLocaleString(fr?'fr-CA':'en-CA',{style:'currency',currency:'CAD'})}</span>
  </div>}
  {service&&<><h3>{fr?'Choisissez une date':'Choose a date'}</h3><p className="booking-notice">{todayHint}</p>
  <div className="booking-month"><button type="button" onClick={()=>changeMonth(-1)} aria-label={fr?'Mois précédent':'Previous month'}>‹</button><strong>{monthDate.toLocaleDateString(fr?'fr-CA':'en-CA',{month:'long',year:'numeric'})}</strong><button type="button" onClick={()=>changeMonth(1)} aria-label={fr?'Mois suivant':'Next month'}>›</button></div>
  {(!calendarReady||calendarBusy)&&!calendarError&&<p className="booking-calendar-message" role="status">{fr?'Vérification des dates disponibles…':'Checking available dates…'}</p>}
  {calendarError&&<div className="booking-calendar-message booking-calendar-error" role="alert">{calendarError} <button type="button" onClick={()=>setCalendarRefresh(n=>n+1)}>{fr?'Réessayer':'Retry'}</button></div>}
  <div className="booking-days">{(fr?['D','L','M','M','J','V','S']:['S','M','T','W','T','F','S']).map((d,i)=><span className="booking-weekday" key={i}>{d}</span>)}{cells.map((d,i)=>{
    if(!d)return <span key={'blank'+i}/>;
    const available=calendarReady&&bookableDays.includes(d)&&d>=todayMontreal;
    const published=windows.some(w=>w.day===d);
    const unavailable=calendarReady&&published&&!available&&d>=todayMontreal;
    const label=available?(fr?'Disponible':'Available')
      :unavailable?(fr?'Aucun créneau réservable':'No bookable times')
      :(fr?'Indisponible':'Unavailable');
    return <button type="button" key={d}
      className={[day===d?'selected':'',unavailable?'booking-day-full':''].filter(Boolean).join(' ')}
      disabled={!available} onClick={()=>pickDay(d)}
      aria-label={d+' — '+label} title={label}>
      {Number(d.slice(-2))}
    </button>;
  })}</div>
  {day&&<><h3>{fr?'Heures possibles':'Possible times'}</h3><p className="booking-date-label">{prettyDate} · {formatDuration(service.duration_minutes,language)}</p>{slotsBusy&&!slotsReady&&!slotsError&&<p className="booking-notice">{fr?'Vérification des horaires…':'Checking actual availability…'}</p>}{slotsError&&<div className="booking-calendar-message booking-calendar-error" role="alert">{slotsError} <button type="button" onClick={()=>setSlotsRetry(n=>n+1)}>{fr?'Réessayer':'Retry'}</button></div>}{slotsReady&&liveSlots.length===0&&<p className="booking-notice" role="status">{fr?'Aucune heure réservable pour ce service à cette date. Vérifiez que la plage publiée couvre toute la durée de la coiffure, que le rendez-vous commence dans au moins 24 heures et qu’aucun autre rendez-vous ne chevauche cette période.':'No bookable times for this service on that date. The published window must cover the full service duration, the appointment must be at least 24 hours ahead, and no existing booking can overlap.'}</p>}<div className="booking-time-grid">{(slotsReady?liveSlots:[]).map(t=><button type="button" key={t} className={time===t?'selected':''} onClick={()=>setTime(t)}>{clock(t,language)}</button>)}</div></>}
  {day&&time!==null&&<div className="booking-summary"><strong>{fr?'Votre sélection':'Your selection'}</strong><p>{fr?service.name_fr:service.name_en}</p><p>{prettyDate} · {clock(time,language)}</p><form className="booking-details" onSubmit={submitRequest}>
  <div className="booking-honeypot" aria-hidden="true">
    <label htmlFor="booking-company-website">Website</label>
    <input id="booking-company-website" name="company_website" type="text"
      autoComplete="off" tabIndex={-1} value={companyWebsite}
      onChange={e=>setCompanyWebsite(e.target.value)}/>
  </div>
  <label>{fr?'Nom complet':'Full name'}<input required maxLength={100} minLength={2} autoComplete="name" value={clientName} onChange={e=>setClientName(e.target.value)}/></label><label>{fr?'Courriel':'Email'}<input type="email" required maxLength={254} autoComplete="email" value={clientEmail} onChange={e=>setClientEmail(e.target.value)}/></label><label>{fr?'Téléphone (facultatif)':'Phone (optional)'}<input type="tel" maxLength={35} autoComplete="tel" value={clientPhone} onChange={e=>setClientPhone(e.target.value)}/></label><label className="booking-agreement"><input type="checkbox" required checked={agreed} onChange={e=>setAgreed(e.target.checked)}/><span>{fr?"J'ai lu et j'accepte les politiques de réservation et d'annulation.":"I've read and agree to the booking and cancellation policies."}</span></label><p className="booking-notice">{fr?"Réservez au moins 24 heures à l’avance. Votre demande sera en attente d’approbation. Vous recevrez un courriel avec un lien pour consulter votre réservation.":"Please book at least 24 hours ahead. Your request will be pending approval. You'll receive an email with a private booking-status link."}</p><button type="submit" disabled={sending||!agreed}>{sending?(fr?'Envoi…':'Sending…'):(fr?'Demander le rendez-vous':'Request appointment')}</button>{submitError&&<p className="booking-submit-error" role="alert">{submitError}</p>}</form></div>}
  {success&&<div className="booking-summary" role="status"><strong>{fr?'Demande reçue':'Request received'}</strong><p>{fr?"Votre demande est enregistrée et en attente d'approbation par Lynna.":"Your appointment request is saved and awaiting Lynna’s approval."}</p><p className="booking-notice">{fr?"Conservez votre référence et votre lien privé de réservation.":"Save your reference and private booking link."}</p><div className="booking-friendly-reference"><span>{fr?'Votre référence':'Your reference'}</span><strong>{successRef}</strong></div><div className="booking-deposit-next-step">
 <strong>{fr?'Dépôt de 20 $ CAD':'$20 CAD deposit'}</strong>
 <p>{fr?'Pour réserver votre rendez-vous, envoyez votre dépôt par Virement Interac à :':'To secure your appointment, send your deposit by Interac e-Transfer to:'}</p>
 <a href="mailto:xhair.dreams@gmail.com">xhair.dreams@gmail.com</a>
 <p>{fr?'Inscrivez votre référence de réservation dans le message du virement. Lynna confirmera la réception après avoir vérifié son compte. Si vous avez déjà envoyé le virement, ne l’envoyez pas de nouveau.':'Include your booking reference in the transfer message. Lynna will confirm after checking her account. If you have already sent it, do not send another transfer.'}</p>
</div><p className="booking-notice">{fr?"Conservez ce lien privé pour consulter le statut de votre réservation.":"Save this private link to check your booking status."}</p><a href={"/?booking="+encodeURIComponent(success.id)+"&ref="+encodeURIComponent(successRef)+"#booking-status"}>{fr?"Consulter le statut":"Check booking status"}</a></div>}
  </>}
  <p className="booking-footnote">{fr?"Les horaires indiqués proviennent des disponibilités publiées par Lynna et peuvent changer. Une demande soumise réserve temporairement cette heure jusqu’à la décision de Lynna.":"Displayed times are based on Lynna’s published schedule and may change. Submitted requests hold the selected time until Lynna decides."}</p>
 </div>
}
