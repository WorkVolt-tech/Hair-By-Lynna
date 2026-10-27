// Private, owner-only CSV report data assembled into one standards-compliant
// Excel XLSX workbook. Stays entirely in the owner's browser; no third-party
// spreadsheet API receives customer information.
import {zipSync, strToU8} from 'fflate';
import {appointmentsCsv, paymentsCsv, statisticsCsv} from './businessCsv.js';

const xmlEsc=value=>String(value??'').replace(/&/g,'&amp;')
  .replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
  .replace(/'/g,'&apos;');
const validXmlText=value=>String(value??'').replace(
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g,''
);
function colName(index){
 let out='';
 for(let n=index+1;n>0;n=Math.floor((n-1)/26))
  out=String.fromCharCode(65+(n-1)%26)+out;
 return out;
}
function worksheet(rows,kind){
 const nColumns=rows[0].length;
 const names=new Set();
 const textRows=rows.map((row,rowIndex)=>{
  const cells=row.map((value,colIndex)=>{
   const address=colName(colIndex)+(rowIndex+1);
   // Numeric cells, currency etc., remain useful in Excel for totals and filters.
   // All customer-controlled text is encoded as inlineStr, never Excel formulas.
   const numeric=kind==='payments'&&[9,10,11,13,15].includes(colIndex)||
     kind==='statistics'&&colIndex===3;
   const source=String(value??'');
   if(rowIndex>0&&numeric&&/^-?\d+(?:\.\d+)?$/.test(source)){
    const monetary=kind==='payments'||
      kind==='statistics'&&/\(CAD\)/.test(String(row[2]??''));
    return '<c r="'+address+'" s="'+(monetary?2:1)+'"><v>'+source+'</v></c>';
   }
   const sanitized=validXmlText(source).slice(0,32767);
   if(sanitized!==source)names.add('adjusted');
   return '<c r="'+address+'"'+(rowIndex===0?' s="3"':'')+
     ' t="inlineStr"><is><t xml:space="preserve">'+xmlEsc(sanitized)+'</t></is></c>';
  }).join('');
  return '<row r="'+(rowIndex+1)+'">'+cells+'</row>';
 }).join('');
 if(names.size)console.warn('Excel export: one or more cell values were shortened/cleaned');
 const widths=Array.from({length:nColumns},(_,i)=>{
  const first=String(rows[0][i]||'').length;
  let best=Math.max(12,Math.min(first+3,33));
  if(kind!=='statistics'&&[1,2,3].includes(i))best=i===2?33:25;
  if(kind==='statistics'&&i===2)best=47;
  return '<col min="'+(i+1)+'" max="'+(i+1)+'" width="'+best+'" customWidth="1"/>';
 }).join('');
 const last=colName(nColumns-1)+Math.max(1,rows.length);
 return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
  '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'+
  '<dimension ref="A1:'+last+'"/>'+
  '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'+
  '<sheetFormatPr defaultRowHeight="16"/><cols>'+widths+'</cols>'+
  '<sheetData>'+textRows+'</sheetData><autoFilter ref="A1:'+last+'"/></worksheet>';
}

export function makeMonthlyExcel(records,stats,fr){
 if(!stats?.month||!Array.isArray(records))throw new Error('Invalid report data');
 if(records.length>25000)throw new Error('Too many appointments for one workbook');
 const sheets=[
  {name:fr?'Rendez-vous':'Appointments',kind:'appointments',data:appointmentsCsv(records,fr)},
  {name:fr?'Paiements':'Payments',kind:'payments',data:paymentsCsv(records,fr)},
  {name:fr?'Statistiques':'Statistics',kind:'statistics',data:statisticsCsv(stats,fr)}
 ];
 const workbookSheets=sheets.map((s,i)=>
  '<sheet name="'+xmlEsc(s.name)+'" sheetId="'+(i+1)+'" r:id="rId'+(i+1)+'"/>').join('');
 const relationships=sheets.map((_,i)=>
  '<Relationship Id="rId'+(i+1)+'" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet'+(i+1)+'.xml"/>').join('');
 const types=sheets.map((_,i)=>
  '<Override PartName="/xl/worksheets/sheet'+(i+1)+'.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('');
 const files={
  '[Content_Types].xml':strToU8('<?xml version="1.0" encoding="UTF-8"?>'+
   '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'+
   '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'+
   '<Default Extension="xml" ContentType="application/xml"/>'+
   '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'+
   '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'+types+'</Types>'),
  '_rels/.rels':strToU8('<?xml version="1.0" encoding="UTF-8"?>'+
   '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+
   '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'),
  'xl/workbook.xml':strToU8('<?xml version="1.0" encoding="UTF-8"?>'+
   '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'+
   '<bookViews><workbookView/></bookViews><sheets>'+workbookSheets+'</sheets></workbook>'),
  'xl/_rels/workbook.xml.rels':strToU8('<?xml version="1.0" encoding="UTF-8"?>'+
   '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+
   relationships+'<Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'),
  'xl/styles.xml':strToU8('<?xml version="1.0" encoding="UTF-8"?>'+
   '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'+
   '<fonts count="2"><font><sz val="11"/><name val="Aptos"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Aptos"/></font></fonts>'+
   '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF48283F"/><bgColor indexed="64"/></patternFill></fill></fills>'+
   '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'+
   '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'+
   '<cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'+
   '<xf numFmtId="1" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>'+
   '<xf numFmtId="2" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>'+
   '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFill="1" applyFont="1"/></cellXfs>'+
   '</styleSheet>')
 };
 sheets.forEach((s,i)=>{files['xl/worksheets/sheet'+(i+1)+'.xml']=strToU8(worksheet(s.data,s.kind))});
 return zipSync(files,{level:6});
}
export function downloadMonthlyExcel(records,stats,month,fr){
 if(stats?.month!==month)throw new Error('Report month mismatch');
 const bytes=makeMonthlyExcel(records,stats,fr);
 const blob=new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
 const url=URL.createObjectURL(blob);
 const a=document.createElement('a');
 a.href=url;a.download='hair-by-lynna-reports-'+month+'.xlsx';a.style.display='none';
 document.body.appendChild(a);
 try{a.click()}finally{
  a.remove();
  window.setTimeout(()=>URL.revokeObjectURL(url),60000);
 }
 return {count:records.length};
}
