import { bookingReference } from './bookingReference.js';

// Excel/Sheets-compatible UTF-8 CSV. Prevent spreadsheet formulas supplied
// through names, email addresses and customizable hairstyle names from executing.
function safeCell(value){
  let text=value===null||value===undefined?'':String(value);
  if (/^[\s\uFEFF]*[=+@\-]/u.test(text) || /^[\t\r]/u.test(text))text="'"+text;
  return '"'+text.replace(/"/g,'""')+'"';
}
export function toCsv(rows){
  return '\uFEFF'+rows.map(row=>row.map(safeCell).join(',')).join('\r\n')+'\r\n';
}
export function saveCsv(filename,rows){
  const blob=new Blob([toCsv(rows)],{type:'text/csv;charset=utf-8'});
  const url=URL.createObjectURL(blob);
  const link=document.createElement('a');
  link.href=url;
  link.download=filename;
  link.style.display='none';
  document.body.appendChild(link);
  try{link.click()}finally{
    link.remove();
    window.setTimeout(()=>URL.revokeObjectURL(url),30000);
  }
}
const numeric=value=>Number.isFinite(Number(value))?Number(value):0;
const amount=value=>(numeric(value)/100).toFixed(2);
const confirmedDeposit=a=>a.deposit_received_at?numeric(a.deposit_amount_cents):0;
const confirmedFinal=a=>a.final_payment_received_at&&a.status==='completed'?numeric(a.final_payment_amount_cents):0;
const outstanding=a=>a.status==='completed'?Math.max(0,numeric(a.service_price_cents)-confirmedDeposit(a)-confirmedFinal(a)):null;
const serviceName=(a,fr)=>fr?(a.service_name_fr||a.service_name_en||'Service'):(a.service_name_en||a.service_name_fr||'Service');
const statusLabels={
  pending:['Pending','En attente'],approved:['Approved','Approuvé'],
  completed:['Completed','Terminé'],cancelled:['Cancelled','Annulé'],
  declined:['Declined','Refusé']
};
const statusLabel=(status,fr)=>statusLabels[status]?.[fr?1:0]||status||'';
function dateParts(value){
  if(!value)return {date:'',time:''};
  const d=new Date(value);
  if(!Number.isFinite(d.getTime()))return {date:'',time:''};
  const parts=new Intl.DateTimeFormat('en-CA',{
    timeZone:'America/Toronto',year:'numeric',month:'2-digit',day:'2-digit',
    hour:'2-digit',minute:'2-digit',hourCycle:'h23'
  }).formatToParts(d);
  const x=type=>parts.find(p=>p.type===type)?.value||'';
  return {date:x('year')+'-'+x('month')+'-'+x('day'),time:x('hour')+':'+x('minute')};
}
function base(a,fr){
  const start=dateParts(a.starts_at),end=dateParts(a.ends_at);
  return [
    bookingReference(a.appointment_id,a.starts_at),
    a.customer_name||'',a.customer_email||'',serviceName(a,fr),
    start.date,start.time,end.date,end.time,statusLabel(a.status,fr)
  ];
}
export function appointmentsCsv(records,fr){
  const headings=fr
    ?['Référence','Client','Courriel','Coiffure','Date (Montréal)','Heure de début','Date de fin','Heure de fin','Statut','Terminé le (Montréal)']
    :['Booking reference','Customer','Email','Hairstyle','Date (Montréal)','Start time','End date','End time','Status','Completed on (Montréal)'];
  return [headings,...records.map(a=>{
    const completed=dateParts(a.completed_at);
    return [...base(a,fr),completed.date?(completed.date+' '+completed.time):''];
  })];
}
export function paymentsCsv(records,fr){
  const headings=fr
    ?['Référence','Client','Courriel','Coiffure','Date (Montréal)','Heure de début','Date de fin','Heure de fin','Statut','Prix du service (CAD)','Dépôt prévu (CAD)','Dépôt reçu (CAD)','Date de réception du dépôt (Montréal)','Paiement final reçu (CAD)','Date de réception finale (Montréal)','Solde dû - terminés (CAD)']
    :['Booking reference','Customer','Email','Hairstyle','Date (Montréal)','Start time','End date','End time','Status','Service price (CAD)','Expected deposit (CAD)','Confirmed deposit (CAD)','Deposit confirmed on (Montréal)','Confirmed final payment (CAD)','Final confirmed on (Montréal)','Outstanding - completed only (CAD)'];
  return [headings,...records.map(a=>{
    const deposit=dateParts(a.deposit_received_at),final=dateParts(a.final_payment_received_at);
    const due=outstanding(a);
    return [...base(a,fr),amount(a.service_price_cents),amount(a.deposit_amount_cents),
      amount(confirmedDeposit(a)),
      deposit.date?deposit.date+' '+deposit.time:'',
      amount(confirmedFinal(a)),
      final.date?final.date+' '+final.time:'',
      due===null?'':amount(due)];
  })];
}
export function statisticsCsv(stats,fr){
  const month=stats.month||'';
  const en=fr?{
    headers:['Mois du rendez-vous','Catégorie','Indicateur','Valeur'],
    summary:'Résumé',payment:'Paiements',popular:'Coiffures populaires',trend:'Tendance sur six mois',
    names:['Tous les rendez-vous','En attente','Approuvés','Terminés','Annulés','Refusés','Clients distincts','Valeur des services terminés (CAD)','Dépôts confirmés (CAD)','Paiements finaux confirmés (CAD)','Total des paiements enregistrés (CAD)','Solde dû - rendez-vous terminés (CAD)','Rendez-vous terminés avec solde'],
    bookings:'réservations',completed:'terminés',trendDone:'Rendez-vous terminés',trendPaid:'Paiements enregistrés (CAD)'
  }:{
    headers:['Appointment month','Category','Metric','Value'],
    summary:'Overview',payment:'Payments',popular:'Popular hairstyles',trend:'Six-month trend',
    names:['All bookings','Pending','Approved','Completed','Cancelled','Declined','Distinct clients','Value of completed services (CAD)','Confirmed deposits (CAD)','Confirmed final payments (CAD)','Total recorded payments (CAD)','Outstanding on completed appointments (CAD)','Completed appointments with balance'],
    bookings:'bookings',completed:'completed',trendDone:'Completed appointments',trendPaid:'Recorded payments (CAD)'
  };
  const rows=[en.headers],add=(category,metric,value,period=month)=>rows.push([period,category,metric,value]);
  const fields=[
    stats.all_bookings,stats.pending,stats.approved,stats.completed,stats.cancelled,stats.declined,stats.clients,
    amount(stats.completed_service_value_cents),
    amount(stats.deposit_received_cents),amount(stats.final_received_cents),
    amount(stats.total_received_cents),amount(stats.outstanding_completed_cents),
    stats.outstanding_completed_count
  ];
  fields.forEach((value,index)=>add(index>=8&&index<=10?en.payment:en.summary,en.names[index],value??0));
  (stats.top_styles||[]).forEach(style=>{
    const name=fr?(style.name_fr||style.name_en):(style.name_en||style.name_fr);
    add(en.popular,name+' — '+en.bookings,style.bookings??0);
    add(en.popular,name+' — '+en.completed,style.completed??0);
  });
  (stats.trend||[]).forEach(item=>{
    add(en.trend,en.trendDone,item.completed??0,item.month);
    add(en.trend,en.trendPaid,amount(item.received_cents),item.month);
  });
  return rows;
}
