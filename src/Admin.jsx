import React, { useEffect, useState } from 'react';
import { supabase } from './lib/supabase.js';
import { CalendarDays, ClipboardList, Scissors, LockKeyhole, LogOut } from 'lucide-react';
import './admin.css';
import AvailabilityCalendar from './AvailabilityCalendar.jsx';

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
 async function addService(e){e.preventDefault();setBusy(true);setError('');
  const {error}=await supabase.from('services').insert({name_en:nameEn.trim(),name_fr:nameFr.trim(),duration_minutes:Number(minutes),price_cents:Math.round(Number(price)*100),active:false});
  if(error)setError(error.message);else{setNameEn('');setNameFr('');await reload()}setBusy(false);
 }
 async function toggleService(s){setBusy(true);setError('');const {error}=await supabase.from('services').update({active:!s.active}).eq('id',s.id);
  if(error)setError(error.message);else await reload();setBusy(false);
 }
 return <div className="admin-page"><header className="admin-bar"><a href="/" className="admin-logo">Hair <span>by Lynna</span></a><div className="admin-actions"><button type="button" onClick={()=>setLang(lang==='fr'?'en':'fr')}>{lang==='fr'?'EN':'FR'}</button><a href="/">{t.back}</a>{session&&<button type="button" onClick={()=>supabase.auth.signOut()}><LogOut size={15}/>{t.signOut}</button>}</div></header><main className="admin-main"><h1>{t.title}</h1>{!supabase?<div className="admin-panel">{t.missing}</div>:loading?<p>{t.loading}</p>:!session?<form className="admin-panel admin-login" onSubmit={login}><LockKeyhole size={27} color="#eeb1d0"/><h2>{t.signIn}</h2><label>{t.email}<input type="email" autoComplete="username" required value={email} onChange={e=>setEmail(e.target.value)}/></label><label>{t.password}<input type="password" autoComplete="current-password" required value={password} onChange={e=>setPassword(e.target.value)}/></label><button disabled={busy} type="submit">{t.enter}</button></form>:!role?<div className="admin-panel">{t.noAccess}</div>:<><p className="admin-muted">{session.user.email} · {role==='owner'?'Owner':'Tester'}</p><div className="admin-tabs">{[['availability',CalendarDays],['appointments',ClipboardList],['services',Scissors]].map(([item,Icon])=><button type="button" className={tab===item?'current':''} onClick={()=>setTab(item)} key={item}><Icon size={18}/>{t[item]}</button>)}</div><p className="admin-muted">{t.review}</p>{tab==='availability'&&<section className="admin-panel"><h2>{t.availability}</h2><p className="admin-muted">{t.note}</p><AvailabilityCalendar lang={lang} day={day} setDay={setDay} availability={availability} onMove={moveSlot} busy={busy}/><form className="admin-form" onSubmit={addSlot}><label>{t.date}<input type="date" required value={day} onChange={e=>setDay(e.target.value)}/></label><label>{t.start}<input type="time" required value={start} onChange={e=>setStart(e.target.value)}/></label><label>{t.end}<input type="time" required value={end} onChange={e=>setEnd(e.target.value)}/></label><button disabled={busy} type="submit">{t.activate}</button></form><div className="admin-items">{availability.length===0?t.noTimes:availability.map(s=><div className="admin-item" key={s.id}><span>{s.date} · {s.start_time.slice(0,5)}–{s.end_time.slice(0,5)}</span><button disabled={busy} onClick={()=>deleteSlot(s.id)}>{t.remove}</button></div>)}</div></section>}{tab==='services'&&<section className="admin-panel"><h2>{t.services}</h2><form className="admin-form" onSubmit={addService}><label>{t.nameEn}<input required value={nameEn} onChange={e=>setNameEn(e.target.value)}/></label><label>{t.nameFr}<input required value={nameFr} onChange={e=>setNameFr(e.target.value)}/></label><label>{t.minutes}<input type="number" min="15" max="960" required value={minutes} onChange={e=>setMinutes(e.target.value)}/></label><label>{t.price}<input type="number" min="0" step=".01" required value={price} onChange={e=>setPrice(e.target.value)}/></label><button disabled={busy} type="submit">{t.addService}</button></form><div className="admin-items">{services.length===0?t.noServices:services.map(s=><div className="admin-item" key={s.id}><span>{lang==='fr'?s.name_fr:s.name_en} · {s.duration_minutes} min · {(s.price_cents/100).toFixed(2)} $</span><button disabled={busy} onClick={()=>toggleService(s)}>{s.active?t.enabled:t.disabled}</button></div>)}</div></section>}{tab==='appointments'&&<section className="admin-panel"><h2>{t.appointments}</h2><div className="admin-items">{appointments.length===0?t.noAppointments:appointments.map(a=><div className="admin-item" key={a.id}><div><strong>{a.customer_name}</strong> · {a.customer_email}<p>{new Date(a.starts_at).toLocaleString(lang==='fr'?'fr-CA':'en-CA',{timeZone:'America/Toronto'})} · {lang==='fr'?a.services?.name_fr:a.services?.name_en} · {a.status}</p></div></div>)}</div></section>}</>}{error&&<p role="alert" className="admin-error">{error}</p>}</main></div>;
}
