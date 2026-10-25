import React, { useEffect, useRef, useState } from 'react';
import { supabase } from './lib/supabase.js';
import { CalendarDays, ClipboardList, Scissors, LockKeyhole, LogOut, BadgeCheck, AlertCircle, X } from 'lucide-react';
import './admin.css';
import { bookingReference } from './lib/bookingReference.js';
import { durationParts, durationTotal, formatDuration } from './lib/duration.js';
import AvailabilityCalendar from './AvailabilityCalendar.jsx';
import AvailabilityManager from './AvailabilityManager.jsx';

const copy = {
 en: {title:'Admin Dashboard',signIn:'Administrator sign in',email:'Email',password:'Password',enter:'Sign in',signOut:'Sign out',back:'Back to website',noAccess:'This account is not authorized to access the dashboard.',missing:'Supabase configuration is missing. Add the two VITE_SUPABASE variables in Cloudflare Pages.',loading:'Loading…',availability:'Availability',services:'Services',appointments:'Appointments',date:'Date',start:'Start',end:'End',activate:'Activate availability',remove:'Remove',noTimes:'No availability published yet.',nameEn:'Name (English)',nameFr:'Name (French)',durationHours:'Hours',durationMinutes:'Minutes',price:'Price (CAD)',addService:'Add service',noServices:'No services yet.',noAppointments:'No appointments yet.',status:'Status',note:'These times are local to Montréal. Customer booking requests are not enabled yet.',review:'Only authorized admin accounts can view or edit these records.',disabled:'Disabled',enabled:'Enabled'},
 fr: {title:'Tableau de bord',signIn:'Connexion administrateur',email:'Courriel',password:'Mot de passe',enter:'Se connecter',signOut:'Se déconnecter',back:'Retour au site',noAccess:"Ce compte n'a pas accès à l'administration.",missing:'Configuration Supabase manquante. Ajoutez les deux variables VITE_SUPABASE dans Cloudflare Pages.',loading:'Chargement…',availability:'Disponibilités',services:'Services',appointments:'Rendez-vous',date:'Date',start:'Début',end:'Fin',activate:'Activer une disponibilité',remove:'Supprimer',noTimes:'Aucune disponibilité publiée.',nameEn:'Nom (anglais)',nameFr:'Nom (français)',durationHours:'Heures',durationMinutes:'Minutes',price:'Prix (CAD)',addService:'Ajouter le service',noServices:'Aucun service.',noAppointments:'Aucun rendez-vous.',status:'Statut',note:'Heures locales de Montréal. Les réservations des clients ne sont pas encore activées.',review:'Seuls les administrateurs autorisés peuvent voir ou modifier ces données.',disabled:'Désactivé',enabled:'Activé'}
};
const initialDate = () => new Intl.DateTimeFormat('en-CA',{timeZone:'America/Toronto',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export default function Admin(){
 const [lang,setLang]=useState(()=>{try{return localStorage.getItem('lynna-language')==='fr'?'fr':'en'}catch{return 'en'}});
 const t=copy[lang], [session,setSession]=useState(null), [role,setRole]=useState(null);
 const [loading,setLoading]=useState(true), [busy,setBusy]=useState(false),[error,setError]=useState('');
 const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[tab,setTab]=useState('availability');
 const [availability,setAvailability]=useState([]),[services,setServices]=useState([]),[appointments,setAppointments]=useState([]);
 const [oneClientPerDay,setOneClientPerDay]=useState(null);const [day,setDay]=useState(initialDate()),[start,setStart]=useState('09:00'),[end,setEnd]=useState('17:00');
 const [nameEn,setNameEn]=useState(''),[nameFr,setNameFr]=useState(''),[descriptionEn,setDescriptionEn]=useState(''),[descriptionFr,setDescriptionFr]=useState(''),[durationHours,setDurationHours]=useState('3'),[durationMinutes,setDurationMinutes]=useState('0'),[price,setPrice]=useState('0');
 const [editingAppointment,setEditingAppointment]=useState(null),[appointmentDraft,setAppointmentDraft]=useState(null),[appointmentError,setAppointmentError]=useState('');
 const [depositDialog,setDepositDialog]=useState(null),[depositDialogError,setDepositDialogError]=useState('');
 const depositDialogRef=useRef(null);
 const draggingService=useRef(null);
 const [dragOverService,setDragOverService]=useState(null);
 const [editingService,setEditingService]=useState(null),[serviceDraft,setServiceDraft]=useState(null),[serviceMessage,setServiceMessage]=useState('');
 useEffect(()=>{document.documentElement.lang=lang;try{localStorage.setItem('lynna-language',lang)}catch{}},[lang]);
 useEffect(()=>{
   const node=depositDialogRef.current;
   if(!node)return;
   if(depositDialog && !node.open)node.showModal();
   else if(!depositDialog && node.open)node.close();
 },[depositDialog]);
 useEffect(()=>{if(!supabase){setLoading(false);return}let live=true;
   supabase.auth.getSession().then(({data,error})=>{if(live){setSession(data?.session||null);if(error)setError(error.message)}}).finally(()=>{if(live)setLoading(false)});
   const {data:{subscription}}=supabase.auth.onAuthStateChange((_event,s)=>{if(live)setSession(s)});
   return()=>{live=false;subscription.unsubscribe()};
 },[]);
 useEffect(()=>{let live=true;if(!supabase||!session){setRole(null);return}
  setLoading(true);setRole(null);
  supabase.from('admin_users').select('role').eq('user_id',session.user.id).maybeSingle().then(({data,error})=>{
   if(live){setRole(error?null:data?.role||null);if(error)setError(error.message)}
  }).finally(()=>{if(live)setLoading(false)});
  return()=>{live=false};
 },[session?.user?.id]);
 async function reload(){if(!supabase)return;
  const [a,s,p]=await Promise.all([
   supabase.from('availability').select('*').order('date').order('start_time'),
   supabase.from('services').select('*').order('sort_order'),
   supabase.from('appointments').select('*, services(name_en,name_fr)').order('starts_at',{ascending:false}).limit(100)
  ]);
  const e=a.error||s.error||p.error;if(e)setError(e.message);
  else{setAvailability(a.data||[]);setServices(s.data||[]);setAppointments(p.data||[])}
 }
 useEffect(()=>{if(role){reload();supabase.rpc('get_one_client_per_day').then(({data,error})=>{if(!error)setOneClientPerDay(Boolean(data));else setError(error.message)})}},[role]);
 async function changeDailyLimit(enabled){
  if(busy||role!=='owner')return;
  setBusy(true);setError('');
  const {data,error}=await supabase.rpc('owner_set_one_client_per_day',{p_enabled:enabled});
  if(error)setError(error.message);else setOneClientPerDay(Boolean(data));
  setBusy(false);
 }

 // Receive changes instantly via Supabase Realtime when enabled. Keep a short
 // visibility-aware poll as a fallback if Realtime is not in the publication.
 useEffect(()=>{
  if(!supabase||!role||!session?.user?.id)return;
  let alive=true,fetching=false,queued=false;
  async function syncAppointments(){
   if(!alive)return;
   if(fetching){queued=true;return}
   fetching=true;
   do{
    queued=false;
    const {data,error}=await supabase.from('appointments')
      .select('*, services(name_en,name_fr)')
      .order('starts_at',{ascending:false}).limit(100);
    if(!alive)break;
    if(!error)setAppointments(data||[]);
   }while(alive&&queued);
   fetching=false;
  }
  const channel=supabase.channel('lynna-admin-appointments-'+session.user.id)
   .on('postgres_changes',{event:'*',schema:'public',table:'appointments'},()=>{syncAppointments()})
   .subscribe(status=>{if(status==='SUBSCRIBED')syncAppointments()});
  function onVisible(){if(document.visibilityState==='visible')syncAppointments()}
  window.addEventListener('focus',onVisible);
  document.addEventListener('visibilitychange',onVisible);
  const timer=window.setInterval(()=>{if(document.visibilityState==='visible')syncAppointments()},5000);
  return()=>{alive=false;window.clearInterval(timer);window.removeEventListener('focus',onVisible);document.removeEventListener('visibilitychange',onVisible);supabase.removeChannel(channel)};
 },[role,session?.user?.id]);

 useEffect(()=>{
  if(!supabase||!role)return;
  let alive=true,fetching=false;
  async function refreshLists(){
   if(!alive||fetching)return;
   fetching=true;
   const [a,s]=await Promise.all([supabase.from('availability').select('*').order('date').order('start_time'),supabase.from('services').select('*').order('sort_order')]);
   if(alive){if(!a.error)setAvailability(a.data||[]);if(!s.error)setServices(s.data||[])}
   fetching=false;
  }
  const channel=supabase.channel('lynna-admin-availability-services-'+session.user.id)
   .on('postgres_changes',{event:'*',schema:'public',table:'availability'},refreshLists)
   .on('postgres_changes',{event:'*',schema:'public',table:'services'},refreshLists)
   .subscribe();
  const onFocus=()=>{if(document.visibilityState==='visible')refreshLists()};
  window.addEventListener('focus',onFocus);document.addEventListener('visibilitychange',onFocus);
  const id=window.setInterval(onFocus,5000);
  return()=>{alive=false;clearInterval(id);window.removeEventListener('focus',onFocus);document.removeEventListener('visibilitychange',onFocus);supabase.removeChannel(channel)};
 },[role,session?.user?.id]);
 async function login(e){e.preventDefault();setError('');setBusy(true);
  const {error}=await supabase.auth.signInWithPassword({email:email.trim(),password});
  if(error)setError(error.message);setBusy(false);
 }
 async function clearAllSchedules(){
  if(busy)return;
  const message=lang==='fr'?'DANGER : cela supprimera définitivement TOUTES les disponibilités ET TOUS les rendez-vous, y compris les rendez-vous confirmés. Cette action est irréversible.':'DANGER: This permanently deletes ALL availability AND ALL appointments, including confirmed bookings. This cannot be undone.';
  if(!window.confirm(message))return;
  const confirmation=window.prompt(lang==='fr'?'Pour confirmer, écrivez exactement DELETE ALL APPOINTMENTS :':'To confirm, type DELETE ALL APPOINTMENTS exactly:');
  if(confirmation!=='DELETE ALL APPOINTMENTS')return;
  setBusy(true);setError('');
  const {error}=await supabase.rpc('admin_clear_all_schedules',{p_confirmation:confirmation});
  if(error)setError(error.message);else await reload();
  setBusy(false);
 }
 async function addSlot(e){e.preventDefault();setError('');if(end<=start){setError(lang==='fr'?"L'heure de fin doit être après le début.":'End time must be after start time.');return}
  if(availability.some(s=>s.date===day&&s.enabled&&start<s.end_time&&end>s.start_time)){setError(lang==='fr'?'Cette plage chevauche une disponibilité existante.':'This time window overlaps an existing availability window.');return}
  setBusy(true);const {error}=await supabase.from('availability').insert({date:day,start_time:start,end_time:end,enabled:true});
  if(error)setError(error.message);else await reload();setBusy(false);
 }
 async function deleteSlot(id){setBusy(true);setError('');const {error}=await supabase.from('availability').delete().eq('id',id);
  if(error)setError(error.message);else await reload();setBusy(false);
 }
 async function moveSlot(id,date){const slot=availability.find(s=>s.id===id);if(!slot||slot.date===date)return;
  if(availability.some(s=>s.id!==id&&s.date===date&&s.enabled&&slot.start_time<s.end_time&&slot.end_time>s.start_time)){setError(lang==='fr'?'Cette plage chevauche une disponibilité existante.':'This time window overlaps another on the destination date.');return}
  setBusy(true);setError('');const {error}=await supabase.from('availability').update({date}).eq('id',id);
  if(error)setError(error.message);else await reload();setBusy(false);
 }

 async function updateSlot(id,changes){setBusy(true);setError('');const {error}=await supabase.from('availability').update(changes).eq('id',id);if(error)setError(error.message);else await reload();setBusy(false);return error?{ok:false,error:error.message}:{ok:true}}
 async function bulkSave(rows,replaceExisting){
  setBusy(true);setError('');
  try{
   if(rows.length>366)throw new Error('The maximum range is 366 days.');
   const dates=new Set(rows.map(r=>r.date));
   const protectedDates=new Set(appointments.filter(a=>['pending','approved'].includes(a.status)).map(a=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Toronto',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(a.starts_at))));
   if(replaceExisting && [...dates].some(d=>protectedDates.has(d)))throw new Error(lang==='fr'?'Certaines dates ont des rendez-vous en attente ou approuvés. Modifiez-les individuellement.':'Some selected dates have pending or approved appointments. Edit these dates individually.');
   const overlaps=(a,b)=>a.start_time<b.end_time && a.end_time>b.start_time;
   const safe=replaceExisting?rows:rows.filter(r=>!availability.some(s=>s.date===r.date&&overlaps(s,r)));
   if(replaceExisting)throw new Error(lang==='fr'?'Le remplacement en bloc sera activé après ajout des transactions sécurisées. Utilisez Modifier pour les dates particulières.':'Bulk replacement requires a database transaction and is not enabled yet. Use Edit for individual dates.');
   for(let i=0;i<safe.length;i+=100){
     const {error}=await supabase.from('availability').insert(safe.slice(i,i+100));
     if(error)throw error;
   }
   await reload();
   return {ok:true};
  }catch(e){await reload();setError(e.message);return {ok:false,error:e.message}}
  finally{setBusy(false)}
 }
 async function decideAppointment(id,status){
  const message=lang==='fr'?'Confirmer cette décision? Le client sera avisé par courriel.':'Confirm this decision? The customer will be notified by email.';
  if(!window.confirm(message))return;
  setBusy(true);setError('');
  const {error}=await supabase.from('appointments').update({status}).eq('id',id).eq('status','pending');
  if(error)setError(error.message);else await reload();
  setBusy(false);
 }
 const montrealParts=(iso)=>{const pieces=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Toronto',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(iso));const get=k=>pieces.find(p=>p.type===k)?.value;return {date:get('year')+'-'+get('month')+'-'+get('day'),time:get('hour')+':'+get('minute')}};
 function editAppointment(a){const parts=montrealParts(a.starts_at);setEditingAppointment(a.id);setAppointmentDraft(parts);setAppointmentError('')}
 async function saveAppointment(e,a){
  e.preventDefault();if(busy||!appointmentDraft)return;setAppointmentError('');
  const {data,error}=await supabase.rpc('admin_reschedule_appointment',{p_appointment_id:a.id,p_day:appointmentDraft.date,p_time:appointmentDraft.time+':00'});
  if(error){setAppointmentError(error.message);return}
  setEditingAppointment(null);setAppointmentDraft(null);await reload();
 }
 async function cancelAppointment(a){
  if(busy || !['pending','approved'].includes(a.status))return;
  const hoursRemaining=(new Date(a.starts_at).getTime()-Date.now())/3600000;
  const late=hoursRemaining<12;
  const message=late
   ? (lang==='fr'?'Annulation à moins de 12 heures : l’acompte sera perdu selon la politique. Confirmer l’annulation ?':'Cancellation within 12 hours: the deposit will be forfeited under the policy. Confirm cancellation?')
   : (lang==='fr'?'Annuler ce rendez-vous ?':'Cancel this appointment?');
  if(!window.confirm(message))return;
  setBusy(true);setError('');
  const {error}=await supabase.from('appointments').update({status:'cancelled'}).eq('id',a.id).in('status',['pending','approved']);
  if(error)setError(error.message);else await reload();
  setBusy(false);
 }
 function setDepositReceived(a, received){
  if(busy||role!=='owner')return;
  setDepositDialogError('');
  setDepositDialog({
   id:a.id, name:a.customer_name, received,
   amount:new Intl.NumberFormat(lang==='fr'?'fr-CA':'en-CA',{style:'currency',currency:'CAD'})
      .format((a.deposit_amount_cents??2000)/100),
   reference:bookingReference(a.id,a.starts_at)
  });
 }
 async function confirmDepositChange(){
  if(busy||role!=='owner'||!depositDialog)return;
  setBusy(true);setDepositDialogError('');setError('');
  try{
   const {error:rpcError}=await supabase.rpc('admin_set_deposit_received',{
    p_appointment_id:depositDialog.id,p_received:depositDialog.received
   });
   if(rpcError)throw rpcError;
   setDepositDialog(null);
   depositDialogRef.current?.close();
   await reload();
  }catch(ex){
   setDepositDialogError(ex.message||(lang==='fr'?"Impossible de modifier l'état de l'acompte.":'Could not update deposit status.'));
  }finally{setBusy(false)}
 }
 async function permanentlyDeleteAppointment(a){
  if(busy || role!=='owner')return;
  const eligible=['cancelled','declined'].includes(a.status)||new Date(a.ends_at).getTime()<=Date.now();
  if(!eligible)return;
  const warning=lang==='fr'
   ? 'Supprimer définitivement ce rendez-vous et les données du client ? Cette action est irréversible et ne signifie pas simplement annuler le rendez-vous.'
   : 'Permanently delete this appointment and its customer details? This cannot be undone and is different from cancellation.';
  if(!window.confirm(warning))return;
  const confirmation=window.prompt(lang==='fr'?'Écrivez DELETE pour confirmer la suppression :':'Type DELETE to permanently erase this appointment:');
  if(confirmation!=='DELETE')return;
  setBusy(true);setError('');
  const {error}=await supabase.rpc('owner_delete_finished_appointment',{p_appointment_id:a.id});
  if(error)setError(error.message);else await reload();
  setBusy(false);
 }
 async function addService(e){e.preventDefault();
  const duration=durationTotal(durationHours,durationMinutes);
  if(duration===null){setError(lang==='fr'?'La durée doit être de 15 minutes à 16 heures (minutes : 0 à 59).':'Duration must be between 15 minutes and 16 hours (minutes: 0–59).');return}
  setBusy(true);setError('');
  const {error}=await supabase.from('services').insert({name_en:nameEn.trim(),name_fr:nameFr.trim(),description_en:descriptionEn.trim(),description_fr:descriptionFr.trim(),duration_minutes:duration,price_cents:Math.round(Number(price)*100),active:false,sort_order:Math.max(0,...services.map(s=>s.sort_order||0))+10});
  if(error)setError(error.message);else{setNameEn('');setNameFr('');setDescriptionEn('');setDescriptionFr('');await reload()}setBusy(false);
 }
 function beginServiceEdit(s){setError('');setServiceMessage('');setEditingService(s.id);setServiceDraft({name_en:s.name_en||'',name_fr:s.name_fr||'',description_en:s.description_en||'',description_fr:s.description_fr||'',duration_hours:String(durationParts(s.duration_minutes).hours),duration_remainder:String(durationParts(s.duration_minutes).minutes),price:String((s.price_cents/100).toFixed(2))})}
 function changeServiceField(k,v){setServiceDraft(d=>({...d,[k]:v}))}
 async function saveService(e){e.preventDefault();if(!editingService||!serviceDraft||busy)return;
  const draft=serviceDraft;
  const duration=durationTotal(draft.duration_hours,draft.duration_remainder),amount=Number(draft.price);
  const invalidNames=!draft.name_en.trim()||!draft.name_fr.trim();
  const invalidDuration=duration===null;
  const invalidPrice=!Number.isFinite(amount)||amount<0||!(/^[0-9]+([.][0-9]{1,2})?$/).test(draft.price.trim());
  if(invalidNames){setServiceMessage(lang==='fr'?'Le nom du service est requis en anglais et en français.':'Enter the service name in both English and French.');return}
  if(invalidDuration){setServiceMessage(lang==='fr'?'La durée doit être de 15 minutes à 16 heures (minutes : 0 à 59).':'Duration must be between 15 minutes and 16 hours (minutes: 0–59).');return}
  if(invalidPrice){setServiceMessage(lang==='fr'?'Entrez un prix valide avec un maximum de deux décimales.':'Enter a valid price with up to two decimal places.');return}
  setBusy(true);setError('');setServiceMessage('');
  const {error}=await supabase.from('services').update({name_en:draft.name_en.trim(),name_fr:draft.name_fr.trim(),description_en:draft.description_en.trim(),description_fr:draft.description_fr.trim(),duration_minutes:duration,price_cents:Math.round(amount*100)}).eq('id',editingService);
  if(error){setServiceMessage(error.message)}else{await reload();setEditingService(null);setServiceDraft(null)}
  setBusy(false);
 }
 async function deleteService(s){
  if(busy)return;
  const title=lang==='fr'?s.name_fr:s.name_en;
  const confirmed=window.confirm(lang==='fr'?`Supprimer définitivement « ${title} » ? Cette action est irréversible. Les services avec des rendez-vous ne peuvent pas être supprimés.`:`Permanently delete "${title}"? This cannot be undone. Services with appointments cannot be deleted.`);
  if(!confirmed)return;
  setBusy(true);setError('');
  const {count,error:checkError}=await supabase.from('appointments').select('id',{count:'exact',head:true}).eq('service_id',s.id);
  if(checkError){setError(checkError.message);setBusy(false);return}
  if(count>0){setError(lang==='fr'?'Ce service a déjà des rendez-vous. Désactivez-le pour conserver l’historique.':'This service has appointments. Disable it instead to preserve booking history.');setBusy(false);return}
  const {error}=await supabase.from('services').delete().eq('id',s.id);
  if(error)setError(error.code==='23503'?(lang==='fr'?'Ce service est lié à un rendez-vous. Désactivez-le plutôt.':'This service is linked to an appointment. Disable it instead.'):error.message);
  else await reload();
  setBusy(false);
 }
 const orderedServices=()=>[...services].sort((a,b)=>(a.sort_order??0)-(b.sort_order??0)||String(a.created_at||'').localeCompare(String(b.created_at||''))||a.id.localeCompare(b.id));
 async function saveServiceOrder(moved){
  setBusy(true);setError('');
  setServices(moved.map((s,i)=>({...s,sort_order:(i+1)*10})));
  try{
   for(let i=0;i<moved.length;i++){
    const {error}=await supabase.from('services').update({sort_order:(i+1)*10}).eq('id',moved[i].id);
    if(error)throw error;
   }
  }catch(e){setError(e.message)}
  finally{await reload();setBusy(false)}
 }
 async function moveService(serviceId,direction){
  if(busy)return;
  const moved=orderedServices(),idx=moved.findIndex(s=>s.id===serviceId),other=idx+direction;
  if(idx<0||other<0||other>=moved.length)return;
  [moved[idx],moved[other]]=[moved[other],moved[idx]];
  await saveServiceOrder(moved);
 }
 function beginServiceDrag(e,id){
  if(busy||editingService!==null)return;
  if(e.pointerType==='mouse'&&e.button!==0)return;
  draggingService.current={id,pointerId:e.pointerId,startY:e.clientY};
  setDragOverService(id);
  e.currentTarget.setPointerCapture(e.pointerId);
 }
 function trackServiceDrag(e){
  if(!draggingService.current||draggingService.current.pointerId!==e.pointerId)return;
  const target=document.elementFromPoint(e.clientX,e.clientY)?.closest('[data-service-id]')?.dataset.serviceId;
  if(target)setDragOverService(target);
 }
 async function finishServiceDrag(e){
  const drag=draggingService.current;
  if(!drag||drag.pointerId!==e.pointerId)return;
  const target=document.elementFromPoint(e.clientX,e.clientY)?.closest('[data-service-id]')?.dataset.serviceId||dragOverService;
  draggingService.current=null;setDragOverService(null);
  if(!target||drag.id===target||Math.abs(e.clientY-drag.startY)<8)return;
  const moved=orderedServices(),from=moved.findIndex(s=>s.id===drag.id),to=moved.findIndex(s=>s.id===target);
  if(from<0||to<0)return;
  moved.splice(to,0,...moved.splice(from,1));
  await saveServiceOrder(moved);
 }
 function cancelServiceDrag(){draggingService.current=null;setDragOverService(null)}
 async function toggleService(s){setBusy(true);setError('');const {error}=await supabase.from('services').update({active:!s.active}).eq('id',s.id);
  if(error)setError(error.message);else await reload();setBusy(false);
 }
 return <div className="admin-page"><header className="admin-bar"><a href="/" className="admin-logo"><img src="/images/hair-by-lynna-logo.webp" alt="Hair by Lynna" width="140" height="48"/></a><div className="admin-actions"><button type="button" onClick={()=>setLang(lang==='fr'?'en':'fr')}>{lang==='fr'?'EN':'FR'}</button><a href="/">{t.back}</a>{session&&<button type="button" onClick={()=>supabase.auth.signOut()}><LogOut size={15}/>{t.signOut}</button>}</div></header><main className="admin-main"><h1>{t.title}</h1>{!supabase?<div className="admin-panel">{t.missing}</div>:loading?<p>{t.loading}</p>:!session?<form className="admin-panel admin-login" onSubmit={login}><LockKeyhole size={27} color="#eeb1d0"/><h2>{t.signIn}</h2><label>{t.email}<input type="email" autoComplete="username" required value={email} onChange={e=>setEmail(e.target.value)}/></label><label>{t.password}<input type="password" autoComplete="current-password" required value={password} onChange={e=>setPassword(e.target.value)}/></label><button disabled={busy} type="submit">{t.enter}</button></form>:!role?<div className="admin-panel">{t.noAccess}</div>:<><p className="admin-muted">{session.user.email} · {role==='owner'?'Owner':'Tester'}</p><div className="admin-tabs">{[['availability',CalendarDays],['appointments',ClipboardList],['services',Scissors]].map(([item,Icon])=><button type="button" className={tab===item?'current':''} onClick={()=>setTab(item)} key={item}><Icon size={18}/>{t[item]}</button>)}</div><p className="admin-muted">{t.review}</p>{tab==='availability'&&<section className="admin-panel"><h2>{t.availability}</h2><div className="daily-limit-setting"><label className="daily-limit-label"><input type="checkbox" checked={oneClientPerDay===true} disabled={busy||role!=='owner'||oneClientPerDay===null} onChange={e=>changeDailyLimit(e.target.checked)}/><span><strong>{lang==='fr'?'Un seul client par jour':'One client per day'}</strong><small>{lang==='fr'?'Activé : un rendez-vous en attente ou approuvé bloque les autres réservations de cette journée. Désactivé : plusieurs clients sont possibles si les heures ne se chevauchent pas.':'On: one pending or approved booking fills the day. Off: multiple clients can book non-overlapping times.'}</small></span></label>{role!=='owner'&&<p className="admin-muted">{lang==='fr'?'Seule la propriétaire peut modifier ce réglage.':'Only the owner can change this setting.'}</p>}</div><p className="admin-muted">{t.note}</p><div className="admin-danger-zone"><strong>{lang==='fr'?'Réinitialiser toute la planification':'Reset all scheduling'}</strong><p className="admin-muted">{lang==='fr'?'Supprime définitivement TOUTES les disponibilités et TOUS les rendez-vous.':'Permanently deletes ALL availability AND ALL appointments.'}</p><button type="button" className="admin-danger-button" disabled={busy} onClick={clearAllSchedules}>{lang==='fr'?'Tout effacer':'Clear all schedules and appointments'}</button></div><AvailabilityCalendar lang={lang} day={day} setDay={setDay} availability={availability} onMove={moveSlot} busy={busy}/><AvailabilityManager lang={lang} availability={availability} day={day} setDay={setDay} start={start} setStart={setStart} end={end} setEnd={setEnd} busy={busy} onAdd={addSlot} onDelete={deleteSlot} onUpdate={updateSlot} onBulk={bulkSave}/> </section>}{tab==='services'&&<section className="admin-panel"><h2>{t.services}</h2><form className="admin-form service-create-form" onSubmit={addService}><label>{t.nameEn}<input required value={nameEn} onChange={e=>setNameEn(e.target.value)}/></label><label>{t.nameFr}<input required value={nameFr} onChange={e=>setNameFr(e.target.value)}/></label>
 <label className="service-description-field">{lang==='fr'?'Description (anglais)':'Description (English)'}<textarea rows={3} maxLength={1000} value={descriptionEn} onChange={e=>setDescriptionEn(e.target.value)} placeholder={lang==='fr'?'Décrivez le service en anglais':'Describe this service in English'}/></label>
 <label className="service-description-field">{lang==='fr'?'Description (français)':'Description (French)'}<textarea rows={3} maxLength={1000} value={descriptionFr} onChange={e=>setDescriptionFr(e.target.value)} placeholder={lang==='fr'?'Décrivez le service en français':'Describe this service in French'}/></label>
 <div className="service-duration-fields">
  <label>{t.durationHours}<input type="number" min="0" max="16" step="1" required value={durationHours} onChange={e=>setDurationHours(e.target.value)}/></label>
  <label>{t.durationMinutes}<input type="number" min="0" max="59" step="1" required value={durationMinutes} onChange={e=>setDurationMinutes(e.target.value)}/></label>
 </div><label>{t.price}<input type="number" min="0" step=".01" required value={price} onChange={e=>setPrice(e.target.value)}/></label><button disabled={busy} type="submit">{t.addService}</button><p className="service-create-note">{lang==='fr'?'Les nouveaux services sont désactivés par défaut. Après l’ajout, utilisez le bouton rouge « Désactivé » pour l’activer.':'New services start disabled. After adding one, use its red “Disabled” button to enable it.'}</p></form><div className="admin-items">{services.length===0?t.noServices:services.map(s=><div className={"admin-item service-admin-item"+(dragOverService===s.id?" service-drop-target":"")} data-service-id={s.id} key={s.id}>
 {editingService===s.id&&serviceDraft?<form className="service-edit-form" onSubmit={saveService}>
   <h3>{lang==='fr'?'Modifier le service':'Edit service'}</h3>
   <div className="service-edit-grid">
    <label>{t.nameEn}<input required maxLength={140} value={serviceDraft.name_en} onChange={e=>changeServiceField('name_en',e.target.value)}/></label>
    <label>{t.nameFr}<input required maxLength={140} value={serviceDraft.name_fr} onChange={e=>changeServiceField('name_fr',e.target.value)}/></label>
    <label>{lang==='fr'?'Description (anglais)':'Description (English)'}<textarea rows={3} maxLength={1000} value={serviceDraft.description_en} onChange={e=>changeServiceField('description_en',e.target.value)}/></label>
    <label>{lang==='fr'?'Description (français)':'Description (French)'}<textarea rows={3} maxLength={1000} value={serviceDraft.description_fr} onChange={e=>changeServiceField('description_fr',e.target.value)}/></label>
    <div className="service-duration-fields">
     <label>{t.durationHours}<input required type="number" min="0" max="16" step="1" value={serviceDraft.duration_hours} onChange={e=>changeServiceField('duration_hours',e.target.value)}/></label>
     <label>{t.durationMinutes}<input required type="number" min="0" max="59" step="1" value={serviceDraft.duration_remainder} onChange={e=>changeServiceField('duration_remainder',e.target.value)}/></label>
    </div>
    <label>{t.price}<input required type="number" min="0" step=".01" value={serviceDraft.price} onChange={e=>changeServiceField('price',e.target.value)}/></label>
   </div>
   {serviceMessage&&<p role="alert" className="admin-error">{serviceMessage}</p>}
   <p className="admin-muted">{lang==='fr'?'Modifier la durée influence les créneaux futurs; les rendez-vous existants ne changent pas.':'Changing duration affects future available slots; existing appointments stay unchanged.'}</p>
   <div className="service-edit-actions"><button className="service-save" type="submit" disabled={busy}>{lang==='fr'?'Enregistrer':'Save changes'}</button><button type="button" disabled={busy} onClick={()=>{setEditingService(null);setServiceDraft(null);setServiceMessage('')}}>{lang==='fr'?'Annuler':'Cancel'}</button></div>
  </form>:<><div className="service-drag-row"><button type="button" className="service-drag-handle" disabled={busy} aria-label={lang==='fr'?'Glisser pour réordonner':'Drag to reorder'} title={lang==='fr'?'Maintenir et glisser':'Hold and drag'} onPointerDown={e=>beginServiceDrag(e,s.id)} onPointerMove={trackServiceDrag} onPointerUp={finishServiceDrag} onPointerCancel={cancelServiceDrag}>⠿</button><div className="service-summary"><strong>{lang==='fr'?s.name_fr:s.name_en}</strong><span>{formatDuration(s.duration_minutes,lang)} · {(s.price_cents/100).toFixed(2)} $</span>{(lang==='fr'?s.description_fr:s.description_en)&&<p>{lang==='fr'?s.description_fr:s.description_en}</p>}</div></div><div className="service-edit-actions"><button type="button" className="service-move" disabled={busy||services[0]?.id===s.id} onClick={()=>moveService(s.id,-1)} aria-label={lang==='fr'?'Monter le service':'Move service up'} title={lang==='fr'?'Monter':'Move up'}>↑ {lang==='fr'?'Monter':'Up'}</button><button type="button" className="service-move" disabled={busy||services[services.length-1]?.id===s.id} onClick={()=>moveService(s.id,1)} aria-label={lang==='fr'?'Descendre le service':'Move service down'} title={lang==='fr'?'Descendre':'Move down'}>↓ {lang==='fr'?'Descendre':'Down'}</button><button type="button" disabled={busy} onClick={()=>beginServiceEdit(s)}>{lang==='fr'?'Modifier':'Edit'}</button><button type="button" className={'service-status-button '+(s.active?'service-status-enabled':'service-status-disabled')} disabled={busy} aria-pressed={s.active} title={s.active?(lang==='fr'?'Service actif — cliquer pour désactiver':'Service is active — click to disable'):(lang==='fr'?'Service inactif — cliquer pour activer':'Service is inactive — click to enable')} onClick={()=>toggleService(s)}>{s.active?'● ':'○ '}{s.active?t.enabled:t.disabled}</button><button type="button" className="service-delete" disabled={busy} onClick={()=>deleteService(s)}>{lang==='fr'?'Supprimer':'Delete'}</button></div></>}
 </div>)}</div></section>}{tab==='appointments'&&<section className="admin-panel"><h2>{t.appointments}</h2><div className="admin-items">{appointments.length===0?t.noAppointments:appointments.map(a=><div className="admin-item" key={a.id}><div><strong>{a.customer_name}</strong> · {a.customer_email}<p>{new Date(a.starts_at).toLocaleString(lang==='fr'?'fr-CA':'en-CA',{timeZone:'America/Toronto'})} · {lang==='fr'?a.services?.name_fr:a.services?.name_en} · {a.status}</p><p className="appointment-reference">{lang==='fr'?'Référence':'Reference'} : <strong>{bookingReference(a.id,a.starts_at)}</strong></p>
 <div className={'appointment-deposit '+(a.deposit_received_at?'deposit-is-received':'deposit-is-pending')}>
  <strong>{lang==='fr'?'Acompte':'Deposit'}: {new Intl.NumberFormat(lang==='fr'?'fr-CA':'en-CA',{style:'currency',currency:'CAD'}).format((a.deposit_amount_cents??2000)/100)} — {a.deposit_received_at?(lang==='fr'?'Reçu':'Received'):(lang==='fr'?'Non reçu':'Not received')}</strong>
  {a.deposit_received_at?<p>{lang==='fr'?'Confirmé le':'Confirmed on'} {new Date(a.deposit_received_at).toLocaleString(lang==='fr'?'fr-CA':'en-CA',{timeZone:'America/Toronto',dateStyle:'medium',timeStyle:'short'})}</p>:<p>{lang==='fr'?'Vérifiez le virement Interac avant de confirmer.':'Verify the Interac e-Transfer in the bank before confirming.'}</p>}
  {role==='owner'&&  <button type="button" disabled={busy} onClick={()=>setDepositReceived(a,!a.deposit_received_at)}>
   {a.deposit_received_at?(lang==='fr'?'Annuler la confirmation':'Undo deposit confirmation'):(lang==='fr'?'Confirmer la réception de l’acompte':'Confirm deposit received')}
  </button>}
 </div>{a.status==='approved'&&a.reschedule_response&&<div className={'appointment-reschedule-review '+(a.reschedule_response==='needs_contact'?'needs-contact':'')}>
 <strong>{a.reschedule_response==='pending'?(lang==='fr'?'Horaire modifié — confirmation du client en attente':'Time changed — awaiting customer confirmation')
  :a.reschedule_response==='confirmed'?(lang==='fr'?'Nouvel horaire confirmé par le client':'Customer confirmed the new time')
  :(lang==='fr'?'Le client ne peut pas venir — contactez-le':'Customer cannot attend — please contact them')}</strong>
 {a.reschedule_previous_starts_at&&<p>{lang==='fr'?'Ancienne heure':'Previous time'}: {new Date(a.reschedule_previous_starts_at).toLocaleString(lang==='fr'?'fr-CA':'en-CA',{timeZone:'America/Toronto',dateStyle:'medium',timeStyle:'short'})}</p>}
 <p>{lang==='fr'?'Nouvelle heure':'Proposed time'}: {new Date(a.starts_at).toLocaleString(lang==='fr'?'fr-CA':'en-CA',{timeZone:'America/Toronto',dateStyle:'medium',timeStyle:'short'})}</p>
</div>}{a.status==='pending'&&<div className="appointment-actions"><button type="button" disabled={busy} onClick={()=>decideAppointment(a.id,'approved')}>{lang==='fr'?'Approuver':'Approve'}</button><button type="button" disabled={busy} onClick={()=>decideAppointment(a.id,'declined')}>{lang==='fr'?'Refuser':'Decline'}</button></div>}{['pending','approved'].includes(a.status)&&<div className="appointment-actions"><button type="button" className="appointment-cancel" disabled={busy} onClick={()=>cancelAppointment(a)}>{lang==='fr'?'Annuler':'Cancel appointment'}</button></div>}{role==='owner' && (['cancelled','declined'].includes(a.status)||new Date(a.ends_at).getTime()<=Date.now())&&<div className="appointment-actions"><button type="button" className="appointment-cancel" disabled={busy} onClick={()=>permanentlyDeleteAppointment(a)}>{lang==='fr'?'Supprimer définitivement':'Delete permanently'}</button></div>}{a.status==='approved'&&<div className="appointment-actions"><button type="button" disabled={busy} onClick={()=>editAppointment(a)}>{lang==='fr'?'Modifier le rendez-vous':'Edit appointment'}</button></div>}{editingAppointment===a.id&&appointmentDraft&&<form className="appointment-edit-form" onSubmit={e=>saveAppointment(e,a)}><label>{lang==='fr'?'Nouvelle date':'New date'}<input required type="date" value={appointmentDraft.date} onChange={e=>setAppointmentDraft(d=>({...d,date:e.target.value}))}/></label><label>{lang==='fr'?'Nouvelle heure (Montréal)':'New time (Montréal)'}<input required type="time" step="1800" value={appointmentDraft.time} onChange={e=>setAppointmentDraft(d=>({...d,time:e.target.value}))}/></label>{appointmentError&&<p role="alert" className="admin-error">{appointmentError}</p>}<p className="admin-muted">{lang==='fr'?'La disponibilité et les conflits seront vérifiés avant la sauvegarde. Le client sera avisé par courriel et pourra confirmer la nouvelle heure ou indiquer qu’elle ne lui convient pas.':'Availability and conflicts are checked before saving. The customer will receive an email and can confirm the new time or say they cannot attend.'}</p><div className="appointment-actions"><button type="submit" disabled={busy}>{lang==='fr'?'Enregistrer':'Save changes'}</button><button type="button" onClick={()=>{setEditingAppointment(null);setAppointmentDraft(null)}}>{lang==='fr'?'Annuler':'Cancel'}</button></div></form>}</div></div>)}</div></section>}</>}{error&&<p role="alert" className="admin-error">{error}</p>}</main>
 <dialog ref={depositDialogRef} className="admin-deposit-dialog" aria-labelledby="admin-deposit-dialog-title"
   aria-describedby="admin-deposit-dialog-description"
   onClose={()=>{if(!busy){setDepositDialog(null);setDepositDialogError('')}}}
   onCancel={e=>{if(busy)e.preventDefault()}}
   onClick={e=>{if(e.target===e.currentTarget&&!busy)e.currentTarget.close()}}>
   {depositDialog&&<div className="admin-deposit-dialog-content">
     <button type="button" className="admin-deposit-dialog-x" disabled={busy}
       aria-label={lang==='fr'?'Fermer':'Close'} onClick={()=>depositDialogRef.current?.close()}><X size={21}/></button>
     <div className="admin-deposit-dialog-icon" aria-hidden="true">
       {depositDialog.received?<BadgeCheck size={28}/>:<AlertCircle size={28}/>}
     </div>
     <p className="admin-deposit-dialog-kicker">{lang==='fr'?'GESTION DES ACOMPTES':'DEPOSIT MANAGEMENT'}</p>
     <h2 id="admin-deposit-dialog-title">{depositDialog.received
       ?(lang==='fr'?'Confirmer la réception':'Confirm deposit received')
       :(lang==='fr'?'Corriger le statut de l’acompte':'Correct deposit status')}</h2>
     <div className="admin-deposit-dialog-details">
       <strong>{depositDialog.name}</strong>
       <span>{depositDialog.reference}</span>
       <b>{depositDialog.amount}</b>
     </div>
     <p id="admin-deposit-dialog-description">{depositDialog.received
       ?(lang==='fr'?"Avez-vous vérifié que le virement Interac est bien arrivé dans votre compte bancaire ? Ne confirmez que l’argent réellement reçu. Le client recevra un courriel et son portail sera mis à jour.":"Have you verified that the Interac e-Transfer arrived in your bank account? Only confirm money you have actually received. The customer will be emailed and their booking status will update.")
       :(lang==='fr'?"Cette action retirera la confirmation de l’acompte et avisera le client de la correction. Elle n’effectue pas de remboursement.":"This will remove the deposit confirmation and notify the customer of the correction. It does not issue a refund.")}</p>
     {depositDialogError&&<p className="admin-deposit-dialog-error" role="alert">{depositDialogError}</p>}
     <div className="admin-deposit-dialog-actions">
       <button type="button" className="admin-deposit-dialog-secondary" disabled={busy}
         onClick={()=>depositDialogRef.current?.close()}>{lang==='fr'?'Annuler':'Cancel'}</button>
       <button type="button" className={depositDialog.received?'admin-deposit-dialog-primary':'admin-deposit-dialog-correction'} disabled={busy}
         onClick={confirmDepositChange}>{busy?(lang==='fr'?'Enregistrement…':'Saving…')
            :depositDialog.received?(lang==='fr'?'Oui, acompte reçu':'Yes, deposit received')
              :(lang==='fr'?'Retirer la confirmation':'Remove confirmation')}</button>
     </div>
   </div>}
 </dialog>
 </div>;
}
