import React, { useState } from 'react';

const weekdaysEn=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
const weekdaysFr=['Lun','Mar','Mer','Jeu','Ven','Sam','Dim'];
const pad=n=>String(n).padStart(2,'0');
const key=d=>[d.getFullYear(),pad(d.getMonth()+1),pad(d.getDate())].join('-');
const fromKey=s=>{const [y,m,d]=s.split('-').map(Number);return new Date(y,m-1,d,12)};
const overlaps=(a,b)=>a.start_time<b.end_time && a.end_time>b.start_time;
export default function AvailabilityManager({lang,availability,day,setDay,start,setStart,end,setEnd,busy,onAdd,onDelete,onUpdate,onBulk}){
 const fr=lang==='fr';
 const [mode,setMode]=useState('single');
 const [from,setFrom]=useState(day);
 const [to,setTo]=useState(()=>{const d=fromKey(day);d.setDate(d.getDate()+27);return key(d)});
 const [weekdays,setWeekdays]=useState([0,1,2,3,4]);
 const [bulkStart,setBulkStart]=useState('09:00');
 const [bulkEnd,setBulkEnd]=useState('17:00');
 const [replacement,setReplacement]=useState(false);
 const [editId,setEditId]=useState(null);
 const [editStart,setEditStart]=useState('');
 const [editEnd,setEditEnd]=useState('');
 const [preview,setPreview]=useState(null);
 const [message,setMessage]=useState('');
 const selected=availability.filter(s=>s.date===day).sort((a,b)=>a.start_time.localeCompare(b.start_time));
 function makePreview(e){e.preventDefault();setMessage('');
   if(to<from||!weekdays.length||bulkEnd<=bulkStart){setMessage(fr?'Vérifiez la plage de dates, les jours et les heures.':'Check date range, weekdays, and hours.');return}
   const d=fromKey(from),last=fromKey(to),rows=[];
   for(let i=0;d<=last&&i<367;i++,d.setDate(d.getDate()+1)){
     const weekday=(d.getDay()+6)%7;
     if(weekdays.includes(weekday))rows.push({date:key(d),start_time:bulkStart,end_time:bulkEnd,enabled:true});
   }
   if(!rows.length){setMessage(fr?'Aucune date correspondante.':'No matching dates.');return}
   const conflicts=rows.filter(n=>availability.some(s=>s.date===n.date&&overlaps(s,n)));
   setPreview({rows,conflicts});
 }
 async function commit(){if(!preview)return;const result=await onBulk(preview.rows,replacement);if(result?.ok){setMessage(fr?'Disponibilités enregistrées.':'Availability saved.');setPreview(null)}else setMessage(result?.error||'Unable to save.')}
 function edit(s){setEditId(s.id);setEditStart(s.start_time.slice(0,5));setEditEnd(s.end_time.slice(0,5))}
 async function saveEdit(s){if(editEnd<=editStart){setMessage(fr?'Heures invalides.':'Invalid times.');return}
 const conflict=availability.some(other=>other.id!==s.id&&other.date===s.date&&overlaps(other,{start_time:editStart,end_time:editEnd}));
 if(conflict){setMessage(fr?'Cette plage chevauche une autre disponibilité.':'This overlaps another availability window.');return}
 const r=await onUpdate(s.id,{start_time:editStart,end_time:editEnd});if(r?.ok){setEditId(null);setMessage('')}else setMessage(r?.error||'Unable to save')}
 return <div className="availability-editor">
   <div className="schedule-mode" role="group" aria-label={fr?'Mode de planification':'Schedule mode'}>
     <button type="button" className={mode==='single'?'active':''} onClick={()=>setMode('single')}>{fr?'Un jour':'Single day'}</button>
     <button type="button" className={mode==='bulk'?'active':''} onClick={()=>setMode('bulk')}>{fr?'Semaines et mois':'Weeks & months'}</button>
   </div>
   {mode==='bulk'?<form onSubmit={makePreview} className="bulk-editor">
     <h3>{fr?'Publier plusieurs journées':'Publish multiple days'}</h3>
     <div className="admin-form">
       <label>{fr?'Du':'From'}<input type="date" required value={from} onChange={e=>{setFrom(e.target.value);setPreview(null)}}/></label>
       <label>{fr?'Au':'To'}<input type="date" required min={from} value={to} onChange={e=>{setTo(e.target.value);setPreview(null)}}/></label>
       <label>{fr?'Début':'Start'}<input type="time" required value={bulkStart} onChange={e=>{setBulkStart(e.target.value);setPreview(null)}}/></label>
       <label>{fr?'Fin':'End'}<input type="time" required value={bulkEnd} onChange={e=>{setBulkEnd(e.target.value);setPreview(null)}}/></label>
     </div>
     <p className="admin-muted">{fr?'Choisissez les jours de la semaine':'Choose recurring weekdays'}</p>
     <div className="weekday-picker">{(fr?weekdaysFr:weekdaysEn).map((label,i)=><label key={i} className={weekdays.includes(i)?'chosen':''}><input type="checkbox" checked={weekdays.includes(i)} onChange={e=>{setWeekdays(v=>e.target.checked?[...v,i]:v.filter(x=>x!==i));setPreview(null)}}/>{label}</label>)}</div>
     <label className="bulk-replace"><input type="checkbox" disabled checked={false} onChange={()=>{}}/>{fr?'Remplacement en bloc : bientôt disponible':'Bulk replacement: coming soon'}</label>
     <p className="admin-muted">{replacement?(fr?'Attention : les disponibilités existantes sur ces dates seront remplacées. Les rendez-vous existants ne seront pas déplacés.':'Warning: existing availability on selected dates will be replaced. Existing appointments will not move.'):(fr?'Les dates ayant déjà une plage chevauchante seront ignorées.':'Dates with overlapping time windows will be skipped.')}</p>
     <button className="admin-primary" type="submit" disabled={busy}>{fr?'Prévisualiser les dates':'Preview dates'}</button>
     {preview&&<div className="bulk-preview"><strong>{preview.rows.length} {fr?'journées sélectionnées':'selected days'}</strong><p>{preview.conflicts.length} {fr?'chevauchements détectés':'overlaps detected'}</p><p className="admin-muted">{replacement?(fr?'Les plages existantes seront remplacées après confirmation.':'Existing windows will be replaced after confirmation.'):(fr?'Seules les plages sans conflit seront ajoutées.':'Only non-conflicting windows will be added.')}</p><button type="button" className="admin-primary" disabled={busy} onClick={commit}>{fr?'Confirmer et enregistrer':'Confirm and save'}</button></div>}
   </form>:<form className="admin-form" onSubmit={onAdd}>
      <label>{fr?'Date':'Date'}<input type="date" required value={day} onChange={e=>setDay(e.target.value)}/></label>
      <label>{fr?'Début':'Start'}<input type="time" required value={start} onChange={e=>setStart(e.target.value)}/></label>
      <label>{fr?'Fin':'End'}<input type="time" required value={end} onChange={e=>setEnd(e.target.value)}/></label>
      <button type="submit" disabled={busy}>{fr?'Ajouter une disponibilité':'Add availability'}</button>
     </form>}
   <h3 className="schedule-day-title">{fr?'Modifier le':'Edit'} {day}</h3>
   <div className="admin-items">{selected.length===0?<p className="admin-muted">{fr?'Aucune plage pour cette journée.':'No windows for this date.'}</p>:selected.map(s=><div className="admin-item slot-edit-row" key={s.id}>
     {editId===s.id?<div className="slot-edit-fields"><div className="slot-edit-times"><label>{fr?'Début':'Start'}<input type="time" value={editStart} onChange={e=>setEditStart(e.target.value)}/></label><label>{fr?'Fin':'End'}<input type="time" value={editEnd} onChange={e=>setEditEnd(e.target.value)}/></label></div><div className="slot-edit-actions"><button className="slot-save" disabled={busy} onClick={()=>saveEdit(s)} type="button">{fr?'Enregistrer':'Save'}</button><button className="slot-cancel" disabled={busy} onClick={()=>setEditId(null)} type="button">{fr?'Annuler':'Cancel'}</button></div></div>:<><span>{s.start_time.slice(0,5)}–{s.end_time.slice(0,5)}</span><div className="slot-row-actions"><button type="button" disabled={busy} onClick={()=>edit(s)}>{fr?'Modifier':'Edit'}</button><button type="button" disabled={busy} onClick={()=>onDelete(s.id)}>{fr?'Supprimer':'Remove'}</button></div></>}
   </div>)}</div>{message&&<p role="status" className="admin-muted">{message}</p>}
 </div>
}
