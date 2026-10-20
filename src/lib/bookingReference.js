// Date/time reference in Montréal local time, with a short ID suffix so that
// cancelled/rebooked appointments at the same time never share a reference.
export function bookingReference(id, appointmentDate, appointmentTime) {
 const hex=String(id||'').replace(/-/g,'').toUpperCase();
 const suffix=/^[0-9A-F]{32}$/.test(hex)?'-'+hex.slice(0,4):'';
 let date=appointmentDate, time=appointmentTime;
 if(appointmentDate instanceof Date || (typeof appointmentDate==='string' && appointmentDate.includes('T'))) {
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Toronto',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(appointmentDate));
  const value=type=>parts.find(x=>x.type===type)?.value||'';
  date=value('year')+'-'+value('month')+'-'+value('day');
  time=value('hour')+':'+value('minute');
 }
 const dateDigits=String(date||'').replace(/-/g,'');
 const timeDigits=String(time||'').replace(/:/g,'').slice(0,4);
 if(/^\d{8}$/.test(dateDigits)&&/^\d{4}$/.test(timeDigits))return 'LYN-'+dateDigits+'-'+timeDigits+suffix;
 return 'LYN-'+(hex.slice(0,10)||'UNKNOWN');
}
