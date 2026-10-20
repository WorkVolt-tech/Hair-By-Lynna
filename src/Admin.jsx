import React, { useEffect, useState } from 'react';
import { supabase } from './lib/supabase.js';
import { CalendarDays, ClipboardList, Scissors, LockKeyhole, LogOut } from 'lucide-react';
import './admin.css';
import { bookingReference } from './lib/bookingReference.js';
import AvailabilityCalendar from './AvailabilityCalendar.jsx';
import AvailabilityManager from './AvailabilityManager.jsx';

const copy = {
 en: {title:'Admin Dashboard',signIn:'Administrator sign in',email:'Email',password:'Password',enter:'Sign in',signOut:'Sign out',back:'Back to website',noAccess:'This account is not authorized to access the dashboard.',missing:'Supabase configuration is missing. Add the two VITE_SUPABASE variables in Cloudflare Pages.',loading:'Loading…',availability:'Availability',services:'Services',appointments:'Appointments',date:'Date',start:'Start',end:'End',activate:'Activate availability',remove:'Remove',noTimes:'No availability published yet.',nameEn:'Name (English)',nameFr:'Name (French)',minutes:'Duration (minutes)',price:'Price (CAD)',addService:'Add service',noServices:'No services yet.',noAppointments:'No appointments yet.',status:'Status',note:'These times are local to Montréal. Customer booking requests are not enabled yet.',review:'Only authorized admin accounts can view or edit these records.',disabled:'Disabled',enabled:'Enabled'},
 fr: {title:'Tableau de bord',signIn:'Connexion administrateur',email:'Courriel',password:'Mot de passe',enter:'Se connecter',signOut:'Se déconnecter',back:'Retour au site',noAccess:"Ce compte n'a pas accès à l'administration.",missing:'Configuration Supabase manquante. Ajoutez les deux variables VITE_SUPABASE dans Cloudflare Pages.',loading:'Chargement…',availability:'Disponibilités',services:'Services',appointments:'Rendez-vous',date:'Date',start:'Début',end:'Fin',activate:'Activer une disponibilité',remove:'Supprimer',noTimes:'Aucune disponibilité publiée.',nameEn:'Nom (anglais)',nameFr:'Nom (français)',minutes:'Durée (minutes)',price:'Prix (CAD)',addService:'Ajouter le service',noServices:'Aucun service.',noAppointments:'Aucun rendez-vous.',status:'Statut',note:'Heures locales de Montréal. Les réservations des clients ne sont pas encore activées.',review:'Seuls les administrateurs autorisés peuvent voir ou modifier ces données.',disabled:'Désactivé',enabled:'Activé'}
};
const initialDate = () => new Intl.DateTimeFormat('en-CA',{timeZone:'America/Toronto',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export default function Admin(){
 const [lang,setLang]=useState(()=>{try{return localStorage.getItem('lynna-language')==='fr'?'fr':'en'}catch{return 'en'}});
 const t=copy[lang], [session,setSession]=useState(null), [role,setRole]=useState(null);
 const [loading,setLoading]=useState(true), [busy,setBusy]=useState(false),[error,setError]=useState('');
 const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[tab,setTab]=useState('availability');
 const [availability,setAvailability]=useState([]),[services,setServices]=useState([]),[appointments,setAppointments]=useState([]);
 const [day,setDay]=useState(initialDate()),[start,setStart]=useState('09:00'),[end,setEnd]=useState('17:00');
 const [nameEn,setNameEn]=useState(''),[nameFr,setNameFr]=useState(''),[minutes,setMinutes]=useState('180'),[price,setPrice]=useState('0');
 const [editingAppointment,setEditingAppointment]=useState(null),[appointmentDraft,setAppointmentDraft]=useState(null),[appointmentError,setAppointmentError]=useState('');
 const [editingService,setEditingService]=useState(null),[serviceDraft,setServiceDraft]=useState(null),[serviceMessage,setServiceMessage]=useState('');
 useEffect(()=>{document.documentElement.lang=lang;try{localStorage.setItem('lynna-language',lang)}catch{}},[lang]);
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
 useEffect(()=>{if(role)reload()},[role]);
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
  const timer=window.setInterval(()=>{if(document.visibilityState==='visible')syncAppointments()},10000);
  return()=>{alive=false;window.clearInterval(timer);window.removeEventListener('focus',onVisible);document.removeEventListener('visibilitychange',onVisible);supabase.removeChannel(channel)};
 },[role,session?.user?.id]);

 async function login(e){e.preventDefault();setError('');setBusy(true);
  const {error}=await supabase.auth.signInWithPassword({email:email.trim(),password});
  if(error)setError(error.message);setBusy(false);
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
  const message=lang==='fr'?'Confirmer cette décision? Le courriel automatique n’est pas encore actif.':'Confirm this decision? Automatic customer email is not enabled yet.';
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
 async function addService(e){e.preventDefault();setBusy(true);setError('');
  const {error}=await supabase.from('services').insert({name_en:nameEn.trim(),name_fr:nameFr.trim(),duration_minutes:Number(minutes),price_cents:Math.round(Number(price)*100),active:false});
  if(error)setError(error.message);else{setNameEn('');setNameFr('');await reload()}setBusy(false);
 }
 function beginServiceEdit(s){setError('');setServiceMessage('');setEditingService(s.id);setServiceDraft({name_en:s.name_en||'',name_fr:s.name_fr||'',description_en:s.description_en||'',description_fr:s.description_fr||'',duration_minutes:String(s.duration_minutes),price:String((s.price_cents/100).toFixed(2))})}
 function changeServiceField(k,v){setServiceDraft(d=>({...d,[k]:v}))}
 async function saveService(e){e.preventDefault();if(!editingService||!serviceDraft||busy)return;
  const draft=serviceDraft;
  const duration=Number(draft.duration_minutes),amount=Number(draft.price);
  const invalidNames=!draft.name_en.trim()||!draft.name_fr.trim();
  const invalidDuration=!Number.isInteger(duration)||duration<15||duration>960;
  const invalidPrice=!Number.isFinite(amount)||amount<0||!(/^[0-9]+([.][0-9]{1,2})?$/).test(draft.price.trim());
  if(invalidNames){setServiceMessage(lang==='fr'?'Le nom du service est requis en anglais et en français.':'Enter the service name in both English and French.');return}
  if(invalidDuration){setServiceMessage(lang==='fr'?'La durée doit être entre 15 et 960 minutes.':'Duration must be between 15 and 960 minutes.');return}
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
 async function toggleService(s){setBusy(true);setError('');const {error}=await supabase.from('services').update({active:!s.active}).eq('id',s.id);
  if(error)setError(error.message);else await reload();setBusy(false);
 }
 return <div className="admin-page"><header className="admin-bar"><a href="/" className="admin-logo"><img src="/images/hair-by-lynna-logo.webp" alt="Hair by Lynna" width="140" height="48"/></a><div className="admin-actions"><button type="button" onClick={()=>setLang(lang==='fr'?'en':'fr')}>{lang==='fr'?'EN':'FR'}</button><a href="/">{t.back}</a>{session&&<button type="button" onClick={()=>supabase.auth.signOut()}><LogOut size={15}/>{t.signOut}</button>}</div></header><main className="admin-main"><h1>{t.title}</h1>{!supabase?<div className="admin-panel">{t.missing}</div>:loading?<p>{t.loading}</p>:!session?<form className="admin-panel admin-login" onSubmit={login}><LockKeyhole size={27} color="#eeb1d0"/><h2>{t.signIn}</h2><label>{t.email}<input type="email" autoComplete="username" required value={email} onChange={e=>setEmail(e.target.value)}/></label><label>{t.password}<input type="password" autoComplete="current-password" required value={password} onChange={e=>setPassword(e.target.value)}/></label><button disabled={busy} type="submit">{t.enter}</button></form>:!role?<div className="admin-panel">{t.noAccess}</div>:<><p className="admin-muted">{session.user.email} · {role==='owner'?'Owner':'Tester'}</p><div className="admin-tabs">{[['availability',CalendarDays],['appointments',ClipboardList],['services',Scissors]].map(([item,Icon])=><button type="button" className={tab===item?'current':''} onClick={()=>setTab(item)} key={item}><Icon size={18}/>{t[item]}</button>)}</div><p className="admin-muted">{t.review}</p>{tab==='availability'&&<section className="admin-panel"><h2>{t.availability}</h2><p className="admin-muted">{t.note}</p><AvailabilityCalendar lang={lang} day={day} setDay={setDay} availability={availability} onMove={moveSlot} busy={busy}/><AvailabilityManager lang={lang} availability={availability} day={day} setDay={setDay} start={start} setStart={setStart} end={end} setEnd={setEnd} busy={busy} onAdd={addSlot} onDelete={deleteSlot} onUpdate={updateSlot} onBulk={bulkSave}/> </section>}{tab==='services'&&<section className="admin-panel"><h2>{t.services}</h2><form className="admin-form" onSubmit={addService}><label>{t.nameEn}<input required value={nameEn} onChange={e=>setNameEn(e.target.value)}/></label><label>{t.nameFr}<input required value={nameFr} onChange={e=>setNameFr(e.target.value)}/></label><label>{t.minutes}<input type="number" min="15" max="960" required value={minutes} onChange={e=>setMinutes(e.target.value)}/></label><label>{t.price}<input type="number" min="0" step=".01" required value={price} onChange={e=>setPrice(e.target.value)}/></label><button disabled={busy} type="submit">{t.addService}</button></form><div className="admin-items">{services.length===0?t.noServices:services.map(s=><div className="admin-item service-admin-item" key={s.id}>
 {editingService===s.id&&serviceDraft?<form className="service-edit-form" onSubmit={saveService}>
   <h3>{lang==='fr'?'Modifier le service':'Edit service'}</h3>
   <div className="service-edit-grid">
    <label>{t.nameEn}<input required maxLength={140} value={serviceDraft.name_en} onChange={e=>changeServiceField('name_en',e.target.value)}/></label>
    <label>{t.nameFr}<input required maxLength={140} value={serviceDraft.name_fr} onChange={e=>changeServiceField('name_fr',e.target.value)}/></label>
    <label>{lang==='fr'?'Description (anglais)':'Description (English)'}<textarea rows={3} maxLength={1000} value={serviceDraft.description_en} onChange={e=>changeServiceField('description_en',e.target.value)}/></label>
    <label>{lang==='fr'?'Description (français)':'Description (French)'}<textarea rows={3} maxLength={1000} value={serviceDraft.description_fr} onChange={e=>changeServiceField('description_fr',e.target.value)}/></label>
    <label>{t.minutes}<input required type="number" min="15" max="960" step="1" value={serviceDraft.duration_minutes} onChange={e=>changeServiceField('duration_minutes',e.target.value)}/></label>
    <label>{t.price}<input required type="number" min="0" step=".01" value={serviceDraft.price} onChange={e=>changeServiceField('price',e.target.value)}/></label>
   </div>
   {serviceMessage&&<p role="alert" className="admin-error">{serviceMessage}</p>}
   <p className="admin-muted">{lang==='fr'?'Modifier la durée influence les créneaux futurs; les rendez-vous existants ne changent pas.':'Changing duration affects future available slots; existing appointments stay unchanged.'}</p>
   <div className="service-edit-actions"><button className="service-save" type="submit" disabled={busy}>{lang==='fr'?'Enregistrer':'Save changes'}</button><button type="button" disabled={busy} onClick={()=>{setEditingService(null);setServiceDraft(null);setServiceMessage('')}}>{lang==='fr'?'Annuler':'Cancel'}</button></div>
  </form>:<><div className="service-summary"><strong>{lang==='fr'?s.name_fr:s.name_en}</strong><span>{s.duration_minutes} min · {(s.price_cents/100).toFixed(2)} $</span>{(lang==='fr'?s.description_fr:s.description_en)&&<p>{lang==='fr'?s.description_fr:s.description_en}</p>}</div><div className="service-edit-actions"><button type="button" disabled={busy} onClick={()=>beginServiceEdit(s)}>{lang==='fr'?'Modifier':'Edit'}</button><button type="button" disabled={busy} onClick={()=>toggleService(s)}>{s.active?t.enabled:t.disabled}</button><button type="button" className="service-delete" disabled={busy} onClick={()=>deleteService(s)}>{lang==='fr'?'Supprimer':'Delete'}</button></div></>}
 </div>)}</div></section>}{tab==='appointments'&&<section className="admin-panel"><h2>{t.appointments}</h2><div className="admin-items">{appointments.length===0?t.noAppointments:appointments.map(a=><div className="admin-item" key={a.id}><div><strong>{a.customer_name}</strong> · {a.customer_email}<p>{new Date(a.starts_at).toLocaleString(lang==='fr'?'fr-CA':'en-CA',{timeZone:'America/Toronto'})} · {lang==='fr'?a.services?.name_fr:a.services?.name_en} · {a.status}</p><p className="appointment-reference">{lang==='fr'?'Référence':'Reference'} : <strong>{bookingReference(a.id,a.starts_at)}</strong></p>{a.status==='pending'&&<div className="appointment-actions"><button type="button" disabled={busy} onClick={()=>decideAppointment(a.id,'approved')}>{lang==='fr'?'Approuver':'Approve'}</button><button type="button" disabled={busy} onClick={()=>decideAppointment(a.id,'declined')}>{lang==='fr'?'Refuser':'Decline'}</button></div>}{a.status==='approved'&&<div className="appointment-actions"><button type="button" disabled={busy} onClick={()=>editAppointment(a)}>{lang==='fr'?'Modifier le rendez-vous':'Edit appointment'}</button></div>}{editingAppointment===a.id&&appointmentDraft&&<form className="appointment-edit-form" onSubmit={e=>saveAppointment(e,a)}><label>{lang==='fr'?'Nouvelle date':'New date'}<input required type="date" value={appointmentDraft.date} onChange={e=>setAppointmentDraft(d=>({...d,date:e.target.value}))}/></label><label>{lang==='fr'?'Nouvelle heure (Montréal)':'New time (Montréal)'}<input required type="time" step="1800" value={appointmentDraft.time} onChange={e=>setAppointmentDraft(d=>({...d,time:e.target.value}))}/></label>{appointmentError&&<p role="alert" className="admin-error">{appointmentError}</p>}<p className="admin-muted">{lang==='fr'?'La disponibilité et les conflits seront vérifiés avant la sauvegarde. Le client ne sera pas avisé automatiquement.':'Availability and conflicts are checked before saving. The customer will not be notified automatically.'}</p><div className="appointment-actions"><button type="submit" disabled={busy}>{lang==='fr'?'Enregistrer':'Save changes'}</button><button type="button" onClick={()=>{setEditingAppointment(null);setAppointmentDraft(null)}}>{lang==='fr'?'Annuler':'Cancel'}</button></div></form>}</div></div>)}</div></section>}</>}{error&&<p role="alert" className="admin-error">{error}</p>}</main></div>;
}
