import React, { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, CalendarDays } from 'lucide-react';
const pad=n=>String(n).padStart(2,'0');
const localKey=d=>[d.getFullYear(),pad(d.getMonth()+1),pad(d.getDate())].join('-');
export default function AvailabilityCalendar({lang,day,setDay,availability,onMove,busy}){
 const fr=lang==='fr';
 const [month,setMonth]=useState(()=>day.slice(0,7));
 const [dragId,setDragId]=useState(null);
 const locale=fr?'fr-CA':'en-CA';
 const [year,mm]=month.split('-').map(Number);
 const first=new Date(year,mm-1,1);
 const lead=first.getDay();
 const total=new Date(year,mm,0).getDate();
 const cells=useMemo(()=>Array.from({length:Math.ceil((lead+total)/7)*7},(_,i)=>{const n=i-lead+1;return n>=1&&n<=total?localKey(new Date(year,mm-1,n)):null}),[year,mm,lead,total]);
 const counts=useMemo(()=>{const map={};for(const s of availability){if(s.enabled)map[s.date]=(map[s.date]||0)+1}return map},[availability]);
 function changeMonth(delta){const d=new Date(year,mm-1+delta,1);setMonth(localKey(d).slice(0,7))}
 function selectDate(date){if(date)setDay(date)}
 function drop(date){if(date&&dragId){onMove(dragId,date);setDay(date)}setDragId(null)}
 return <div className="availability-calendar">
   <div className="calendar-heading"><h3><CalendarDays size={20}/>{first.toLocaleDateString(locale,{month:'long',year:'numeric'})}</h3><div><button type="button" onClick={()=>changeMonth(-1)} aria-label={fr?'Mois précédent':'Previous month'}><ChevronLeft size={18}/></button><button type="button" onClick={()=>{const today=new Date();setMonth(localKey(today).slice(0,7));setDay(localKey(today))}}>{fr?"Aujourd'hui":"Today"}</button><button type="button" onClick={()=>changeMonth(1)} aria-label={fr?'Mois suivant':'Next month'}><ChevronRight size={18}/></button></div></div>
   <div className="calendar-grid">{(fr?['Dim','Lun','Mar','Mer','Jeu','Ven','Sam']:['Sun','Mon','Tue','Wed','Thu','Fri','Sat']).map(x=><div className="calendar-weekday" key={x}>{x}</div>)}
   {cells.map((date,i)=>date?<button type="button" key={date} className={'calendar-date'+(day===date?' selected':'')+(counts[date]?' has-slots':'')} onClick={()=>selectDate(date)} onDragOver={e=>{if(dragId)e.preventDefault()}} onDrop={e=>{e.preventDefault();drop(date)}} aria-label={date+' '+(counts[date]||0)+' '+(fr?'plages disponibles':'available windows')}><span>{Number(date.slice(-2))}</span>{counts[date]>0&&<span className="calendar-count">{counts[date]} {fr?'plage(s)':'slot(s)'}</span>}</button>:<div key={'empty'+i} className="calendar-empty"/>)}</div>
   <p className="admin-muted">{fr?'Choisissez un jour pour gérer ses heures. Sur ordinateur, glissez une plage enregistrée vers un autre jour pour la déplacer.':'Select a day to manage its hours. On desktop, drag an existing saved time window onto another day to move it.'}</p>
   <div className="calendar-drag-source">{availability.filter(s=>s.date===day).map(s=><div key={s.id} draggable={!busy} className="calendar-slot-chip" onDragStart={e=>{e.dataTransfer.effectAllowed='move';setDragId(s.id)}} onDragEnd={()=>setDragId(null)}><span>↕ {s.start_time.slice(0,5)}–{s.end_time.slice(0,5)}</span></div>)}</div>
 </div>
}
