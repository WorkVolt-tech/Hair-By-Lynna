import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from './lib/supabase.js';
import './booking.css';
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
 const [month,setMonth]=useState(()=>{const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Toronto',year:'numeric',month:'2-digit'}).formatToParts(new Date());return parts.find(p=>p.type==='year').value+'-'+parts.find(p=>p.type==='month').value});
 useEffect(()=>{let live=true;async function load(){if(!supabase){if(live){setError(fr?'La réservation est temporairement indisponible.':'Booking is temporarily unavailable.');setLoading(false)}return}
   const [s,w]=await Promise.all([supabase.from('services').select('id,name_en,name_fr,duration_minutes,price_cents').eq('active',true).order('sort_order'),supabase.rpc('public_booking_windows')]);
   if(!live)return;
   if(s.error||w.error)setError(fr?'Les disponibilités ne peuvent pas être chargées pour le moment.':'Availability cannot be loaded right now.');
   setServices(s.data||[]);setWindows(w.data||[]);setLoading(false);
 }load();return()=>{live=false}},[language]);
 const service=services.find(s=>s.id===serviceId);
 const slotsByDay=useMemo(()=>{const result={};if(!service)return result;
 for(const w of windows){const begin=mins(w.starts),end=mins(w.ends);if(!result[w.day])result[w.day]=[];
   for(let t=Math.ceil(begin/30)*30;t+service.duration_minutes<=end;t+=30){if(!result[w.day].includes(t))result[w.day].push(t)}
 }return result},[service,windows]);
 useEffect(()=>{let live=true;setLiveSlots([]);setSlotsReady(false);if(!supabase||!serviceId||!day)return;
 setSlotsBusy(true);
 supabase.rpc('public_booking_slots',{p_service_id:serviceId,p_day:day}).then(({data,error})=>{
  if(!live)return;
  if(!error){setLiveSlots((data||[]).map(x=>mins(x.slot_time)));setSlotsReady(true)}
  else setError(fr?'Les heures exactes ne sont pas encore disponibles.':'Exact appointment times are not available yet.');
 }).finally(()=>{if(live)setSlotsBusy(false)});
 return()=>{live=false};
 },[serviceId,day,language]);
 const cells=useMemo(()=>monthCells(month),[month]);
 function changeMonth(direction){const [y,m]=month.split('-').map(Number);const next=new Date(y,m-1+direction,1);setMonth(dateKey(next).slice(0,7))}
 const monthDate=dateObj(month+'-01');
 function pickService(id){setError('');setServiceId(id);setDay('');setTime(null)}
 function pickDay(d){if(!slotsByDay[d]?.length)return;setError('');setDay(d);setTime(null)}
 const prettyDate=day?dateObj(day).toLocaleDateString(fr?'fr-CA':'en-CA',{weekday:'long',month:'long',day:'numeric',year:'numeric'}):'';
 return <div className="customer-booking">
  <h3>{fr?'Choisissez votre coiffure':'Choose your hairstyle'}</h3>
  {loading?<p>{fr?'Chargement…':'Loading…'}</p>:error?<p role="status" className="booking-notice">{error}</p>:null}
  {!loading&&!services.length&&<p className="booking-notice">{fr?"Les services et les horaires seront affichés ici dès qu'ils seront publiés.":"Services and available times will appear here when Lynna publishes them."}</p>}
  <div className="booking-services">{services.map(s=><button type="button" className={'booking-service'+(serviceId===s.id?' chosen':'')} key={s.id} onClick={()=>pickService(s.id)}><strong>{fr?s.name_fr:s.name_en}</strong><span>{s.duration_minutes} min · {(s.price_cents/100).toLocaleString(fr?'fr-CA':'en-CA',{style:'currency',currency:'CAD'})}</span></button>)}</div>
  {service&&<><h3>{fr?'Choisissez une date':'Choose a date'}</h3>
  <div className="booking-month"><button type="button" onClick={()=>changeMonth(-1)} aria-label={fr?'Mois précédent':'Previous month'}>‹</button><strong>{monthDate.toLocaleDateString(fr?'fr-CA':'en-CA',{month:'long',year:'numeric'})}</strong><button type="button" onClick={()=>changeMonth(1)} aria-label={fr?'Mois suivant':'Next month'}>›</button></div>
  <div className="booking-days">{(fr?['L','M','M','J','V','S','D']:['M','T','W','T','F','S','S']).map((d,i)=><span className="booking-weekday" key={i}>{d}</span>)}{cells.map((d,i)=>d?<button type="button" key={d} className={day===d?'selected':''} disabled={!slotsByDay[d]?.length} onClick={()=>pickDay(d)} aria-label={d}>{Number(d.slice(-2))}</button>:<span key={'blank'+i}/>)}</div>
  {day&&<><h3>{fr?'Heures possibles':'Possible times'}</h3>{slotsBusy&&<p className="booking-notice">{fr?'Vérification des horaires…':'Checking actual availability…'}</p>}<div className="booking-time-grid">{(slotsReady?liveSlots:[]).map(t=><button type="button" key={t} className={time===t?'selected':''} onClick={()=>setTime(t)}>{clock(t,language)}</button>)}</div></>}
  {day&&time!==null&&<div className="booking-summary"><strong>{fr?'Votre sélection':'Your selection'}</strong><p>{fr?service.name_fr:service.name_en}</p><p>{prettyDate} · {clock(time,language)}</p><p className="booking-notice">{fr?"Les horaires présentés sont indicatifs. La réservation et la confirmation seront activées après les vérifications de sécurité.":"Times shown are preliminary. Booking requests and confirmation will be enabled after security checks."}</p><button type="button" disabled>{fr?'Demande de rendez-vous bientôt disponible':'Request booking coming soon'}</button></div>}
  </>}
  <p className="booking-footnote">{fr?"Les horaires indiqués proviennent des disponibilités publiées par Lynna et peuvent changer. Aucun rendez-vous n'est encore enregistré depuis ce calendrier.":"Displayed times are based on Lynna’s published schedule and may change. This calendar does not yet create appointments."}</p>
 </div>
}
