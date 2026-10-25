import React, { useEffect, useMemo, useRef, useState } from 'react';
import { BarChart3, CalendarCheck2, ChevronLeft, ChevronRight, CircleDollarSign, CreditCard, Download, RefreshCw, TrendingUp, Wallet } from 'lucide-react';
import { supabase } from './lib/supabase.js';
import { appointmentsCsv, paymentsCsv, statisticsCsv, saveCsv } from './lib/businessCsv.js';
import './businessStatistics.css';

const currentMontrealMonth=()=>{
  const parts=new Intl.DateTimeFormat('en-CA',{
    timeZone:'America/Toronto',year:'numeric',month:'2-digit'
  }).formatToParts(new Date());
  return parts.find(x=>x.type==='year').value+'-'+parts.find(x=>x.type==='month').value;
};
const shiftMonth=(month,offset)=>{
  const [year,number]=month.split('-').map(Number);
  const date=new Date(Date.UTC(year,number-1+offset,1));
  return date.getUTCFullYear()+'-'+String(date.getUTCMonth()+1).padStart(2,'0');
};
const safeNum=value=>Number.isFinite(Number(value))?Number(value):0;

export default function BusinessStatistics({language}){
  const fr=language==='fr';
  const [month,setMonth]=useState(()=>{try{const saved=sessionStorage.getItem('lynna-admin-stats-month');return /^\d{4}-(0[1-9]|1[0-2])$/.test(saved||'')&&saved<='2100-12'?saved:currentMontrealMonth()}catch{return currentMontrealMonth()}});
  const [stats,setStats]=useState(null);
  const [fetching,setFetching]=useState(true);
  const [error,setError]=useState('');
  const [exporting,setExporting]=useState('');
  const [exportError,setExportError]=useState(''),[exportSuccess,setExportSuccess]=useState('');
  const [revision,setRevision]=useState(0);
  const lastRefreshRef=useRef(0);
  useEffect(()=>{try{sessionStorage.setItem('lynna-admin-stats-month',month)}catch{}},[month]);
  const currentMonth=currentMontrealMonth();
  const money=value=>new Intl.NumberFormat(fr?'fr-CA':'en-CA',{
    style:'currency',currency:'CAD',maximumFractionDigits:2
  }).format(safeNum(value)/100);
  const prettyMonth=value=>new Date(value+'-01T12:00:00').toLocaleDateString(
    fr?'fr-CA':'en-CA',{month:'long',year:'numeric'}
  );
  const shortMonth=value=>new Date(value+'-01T12:00:00').toLocaleDateString(
    fr?'fr-CA':'en-CA',{month:'short'}
  );
  useEffect(()=>{
    let live=true;
    async function readStats(){
      // Preserve cards/charts while refreshing: removing them made the page jump
      // every time the browser regained focus or a screenshot tool opened.
      setFetching(true);setError('');
      if(!supabase){setError(fr?'Statistiques indisponibles.':'Statistics are unavailable.');setFetching(false);return}
      const {data,error:rpcError}=await supabase.rpc('owner_monthly_business_statistics',{
        p_month:month+'-01'
      });
      if(!live)return;
      if(rpcError){
        setError(fr
          ?'Impossible de charger les statistiques. Vérifiez que la migration SQL 019 a bien été exécutée.'
          :'Could not load statistics. Check that Supabase SQL migration 019 has been applied.');
      }else{
        setStats(data);
      }
      lastRefreshRef.current=Date.now();
      setFetching(false);
    }
    readStats();
    return()=>{live=false};
  },[month,revision,language]);
  // Changes to deposits, payment confirmations or completion update the overview.
  // Polling on window focus also catches sessions without Realtime publication.
  useEffect(()=>{
    if(!supabase)return;
    const channel=supabase.channel('lynna-owner-business-statistics')
      .on('postgres_changes',{event:'*',schema:'public',table:'appointments'},
        ()=>setRevision(n=>n+1))
      .subscribe();
    // Screenshot tools and dialogs briefly change focus; avoid a network call
    // and any resulting layout change if data was loaded recently.
    const refreshOnReturn=()=>{
      if(document.visibilityState==='visible'&&Date.now()-lastRefreshRef.current>90000)
        setRevision(n=>n+1);
    };
    window.addEventListener('focus',refreshOnReturn);
    document.addEventListener('visibilitychange',refreshOnReturn);
    const timer=window.setInterval(()=>{
      if(document.visibilityState==='visible'&&Date.now()-lastRefreshRef.current>90000)
        setRevision(n=>n+1);
    },60000);
    return()=>{
      window.clearInterval(timer);
      window.removeEventListener('focus',refreshOnReturn);
      document.removeEventListener('visibilitychange',refreshOnReturn);
      supabase.removeChannel(channel);
    };
  },[]);
  async function exportReport(kind){
    if(exporting||!supabase)return;
    const selectedMonth=month;
    setExporting(kind);setExportError('');setExportSuccess('');
    try{
      if(kind==='statistics'){
        // Ask for a fresh owner-verified snapshot, never an older month's
        // on-screen cache while the user is switching months.
        const {data,error:statsError}=await supabase.rpc('owner_monthly_business_statistics',{
          p_month:selectedMonth+'-01'
        });
        if(statsError||!data||data.month!==selectedMonth)throw new Error('STATS_FAILED');
        saveCsv('hair-by-lynna-statistics-'+selectedMonth+'.csv',statisticsCsv(data,fr));
        setExportSuccess(fr?'Statistiques CSV téléchargées.':'Statistics CSV downloaded.');
      }else{
        // The active and archived admin views have pagination / row limits.
        // Fetch the entire selected month through an OWNER-ONLY SQL function.
        const records=[];
        const pageSize=500,maxRows=25000;
        for(let start=0;start<maxRows;start+=pageSize){
          const {data,error:rowsError}=await supabase.rpc('owner_export_monthly_appointments',{
            p_month:selectedMonth+'-01'
          }).range(start,start+pageSize-1);
          if(rowsError)throw rowsError;
          if(!Array.isArray(data))throw new Error('Invalid export result');
          records.push(...data);
          if(data.length<pageSize)break;
          // A full final page can be the exact end of the result; the next
          // request returns an empty page. Refuse silent truncation.
          if(records.length>=maxRows)throw new Error('Too many records to export');
        }
        const rows=kind==='appointments'?appointmentsCsv(records,fr):paymentsCsv(records,fr);
        const file=kind==='appointments'?'appointments':'payments';
        saveCsv('hair-by-lynna-'+file+'-'+selectedMonth+'.csv',rows);
        setExportSuccess((fr?records.length+' rendez-vous exportés.':records.length+' appointments exported.')+
          (records.length===0?(fr?' Aucun rendez-vous pour ce mois.':' No appointments this month.'):''));
      }
    }catch(e){
      // No raw customer data or file content is logged on export failures.
      setExportError(kind==='statistics'
        ?(fr?'Export impossible. Vérifiez la migration SQL 019 et réessayez.':'Export failed. Check SQL migration 019 and try again.')
        :(fr?'Export impossible. Vérifiez la migration SQL 020 et réessayez.':'Export failed. Check SQL migration 020 and try again.'));
    }finally{
      setExporting('');
    }
  }
  const trend=useMemo(()=>Array.isArray(stats?.trend)?stats.trend:[],[stats]);
  const popular=useMemo(()=>Array.isArray(stats?.top_styles)?stats.top_styles:[],[stats]);
  const mostCompleted=Math.max(1,...trend.map(m=>safeNum(m.completed)));
  const mostReceived=Math.max(1,...trend.map(m=>safeNum(m.received_cents)));
  const mostBooked=Math.max(1,...popular.map(s=>safeNum(s.bookings)));
  const previous=shiftMonth(month,-1),next=shiftMonth(month,1);
  const cards=stats?[
    {key:'completed',icon:CalendarCheck2,label:fr?'Rendez-vous terminés':'Completed appointments',
     value:String(stats.completed??0),
     hint:fr?'Marqués terminés par Lynna':'Manually marked completed'},
    {key:'received',icon:Wallet,label:fr?'Paiements enregistrés':'Recorded payments',
     value:money(stats.total_received_cents),
     hint:fr?'Acomptes et soldes confirmés':'Confirmed deposits and final balances'},
    {key:'outstanding',icon:CreditCard,label:fr?'Solde restant à recevoir':'Outstanding on completed services',
     value:money(stats.outstanding_completed_cents),
     hint:fr?`${stats.outstanding_completed_count??0} rendez-vous terminés avec solde`
       :`${stats.outstanding_completed_count??0} completed appointments with a balance`},
    {key:'value',icon:CircleDollarSign,label:fr?'Valeur des services terminés':'Value of completed services',
     value:money(stats.completed_service_value_cents),
     hint:fr?'Prix des services, non les bénéfices':'Service prices, not profit'}
  ]:[];

  return <section className="admin-panel lynna-statistics" aria-labelledby="lynna-statistics-title" aria-busy={fetching}>
    <div className="stats-heading">
      <div>
        <span className="stats-kicker"><BarChart3 size={17}/>{fr?'APERÇU DE L’ENTREPRISE':'BUSINESS OVERVIEW'}</span>
        <h2 id="lynna-statistics-title">{fr?'Statistiques de Lynna':'Lynna’s Statistics'}</h2>
        <p className="admin-muted">{fr
          ?'Statistiques privées de la propriétaire. Tous les mois sont basés sur la date des rendez-vous, selon l’heure de Montréal.'
          :'Private owner-only insights. Each month is based on the appointment date in Montréal.'}</p>
      </div>
      <button type="button" className="stats-refresh" onClick={()=>setRevision(n=>n+1)}
        disabled={fetching} title={fr?'Actualiser':'Refresh'}>
        <RefreshCw size={16}/>{fr?'Actualiser':'Refresh'}
      </button>
    </div>

    <div className="stats-period-controls">
      <button type="button" aria-label={fr?'Mois précédent':'Previous month'}
        disabled={month<='2020-01'} onClick={()=>setMonth(previous)}><ChevronLeft size={19}/></button>
      <label htmlFor="lynna-stats-month">{fr?'Mois du rendez-vous':'Appointment month'}
        <input id="lynna-stats-month" type="month" min="2020-01" max={currentMonth}
          value={month} onChange={e=>{if(e.target.value&&e.target.value>='2020-01'&&e.target.value<=currentMonth)setMonth(e.target.value)}}/>
      </label>
      <button type="button" aria-label={fr?'Mois suivant':'Next month'}
        disabled={next>currentMonth} onClick={()=>setMonth(next)}><ChevronRight size={19}/></button>
    </div>

    <section className="stats-export" aria-label={fr?'Exporter les rapports CSV':'Export CSV reports'}>
      <div className="stats-export-heading">
        <h3><Download size={18}/>{fr?'Exporter les rapports':'Export reports'}</h3>
        <p>{fr?'Téléchargez les fichiers CSV du mois sélectionné, compatibles avec Excel et Google Sheets.':'Download CSV files for the selected month, compatible with Excel and Google Sheets.'}</p>
      </div>
      <div className="stats-export-buttons">
        {[
          ['appointments',fr?'Historique des rendez-vous':'Appointment history'],
          ['payments',fr?'Rapport de paiements':'Payment report'],
          ['statistics',fr?'Statistiques mensuelles':'Monthly statistics']
        ].map(([kind,label])=><button key={kind} type="button" disabled={Boolean(exporting)}
          onClick={()=>exportReport(kind)} aria-label={(fr?'Télécharger le CSV : ':'Download CSV: ')+label}>
          <Download size={15}/>{exporting===kind?(fr?'Préparation…':'Preparing…'):label}
        </button>)}
      </div>
      <p className="stats-export-privacy">{fr
        ?'Privé : les fichiers de rendez-vous et paiements comprennent des noms et des courriels clients. Conservez-les en sécurité. Les remboursements ne sont pas comptabilisés.'
        :'Private: appointment and payment files include customer names and emails. Store them securely. Refunds are not tracked.'}</p>
      <div className="stats-export-feedback" aria-live="polite">
        {exportError&&<span role="alert" className="stats-export-error">{exportError}</span>}
        {exportSuccess&&<span className="stats-export-success">{exportSuccess}</span>}
      </div>
    </section>

    {fetching&&!stats&&<p className="stats-status" role="status">{fr?'Chargement des statistiques…':'Loading statistics…'}</p>}
    {error&&<div className="stats-error" role="alert">{error}
      <button type="button" onClick={()=>setRevision(n=>n+1)}>{fr?'Réessayer':'Try again'}</button>
    </div>}
    {stats&&<>
      <h3 className="stats-month-title">{prettyMonth(stats.month||month)}</h3>
      <div className="stats-kpi-grid">
        {cards.map(({key,icon:Icon,label,value,hint})=><div key={key} className={'stats-kpi stats-kpi-'+key}>
          <div className="stats-kpi-title"><Icon size={18}/><span>{label}</span></div>
          <strong>{value}</strong><p>{hint}</p>
        </div>)}
      </div>

      <div className="stats-panels">
        <section className="stats-subpanel" aria-labelledby="stats-bookings-title">
          <h3 id="stats-bookings-title"><CalendarCheck2 size={19}/>{fr?'Rendez-vous du mois':'Monthly appointments'}</h3>
          <p className="stats-panel-subtitle">{fr?'Total des demandes et leurs statuts':'All requests and current statuses'}</p>
          <div className="stats-status-grid">
            {[
              [fr?'Total':'Total',stats.all_bookings],
              [fr?'En attente':'Pending',stats.pending],
              [fr?'Approuvés':'Approved',stats.approved],
              [fr?'Terminés':'Completed',stats.completed],
              [fr?'Annulés':'Cancelled',stats.cancelled],
              [fr?'Refusés':'Declined',stats.declined]
            ].map(([label,value])=><div className="stats-status-entry" key={label}>
              <span>{label}</span><strong>{value??0}</strong>
            </div>)}
          </div>
          <p className="stats-panel-footnote">{fr
            ?`${stats.clients??0} client(s) distinct(s) parmi les rendez-vous actifs ou terminés.`
            :`${stats.clients??0} distinct clients among active and completed bookings.`}</p>
        </section>

        <section className="stats-subpanel" aria-labelledby="stats-payments-title">
          <h3 id="stats-payments-title"><Wallet size={19}/>{fr?'Détail des paiements':'Payment breakdown'}</h3>
          <p className="stats-panel-subtitle">{fr
            ?'Montants que Lynna a confirmés manuellement'
            :'Amounts manually confirmed as received by Lynna'}</p>
          <div className="stats-payments-row"><span>{fr?'Acomptes reçus':'Deposits received'}</span><strong>{money(stats.deposit_received_cents)}</strong></div>
          <div className="stats-payments-row"><span>{fr?'Paiements finaux reçus':'Final payments received'}</span><strong>{money(stats.final_received_cents)}</strong></div>
          <div className="stats-payments-row stats-payments-total"><span>{fr?'Total enregistré':'Total recorded'}</span><strong>{money(stats.total_received_cents)}</strong></div>
          <p className="stats-panel-footnote">{fr
            ?'Les acomptes incluent ceux des rendez-vous annulés ou refusés, s’ils sont encore marqués reçus. Les remboursements ne sont pas suivis.'
            :'Deposits include cancelled or declined bookings if still marked received. Refunds are not tracked.'}</p>
        </section>
      </div>

      <section className="stats-subpanel stats-full-panel" aria-labelledby="stats-trend-title">
        <h3 id="stats-trend-title"><TrendingUp size={19}/>{fr?'Tendance sur six mois':'Six-month trend'}</h3>
        <p className="stats-panel-subtitle">{fr
          ?'Rendez-vous terminés et paiements confirmés, par mois de rendez-vous'
          :'Completed appointments and confirmed payments, by appointment month'}</p>
        <div className="stats-trends">
          <div className="stats-trend-chart" aria-label={fr?'Rendez-vous terminés':'Completed appointments'}>
            <strong>{fr?'Rendez-vous terminés':'Completed appointments'}</strong>
            <div className="stats-bars">{trend.map(item=><div key={item.month} className="stats-bar-item">
              <span className="stats-bar-number">{item.completed??0}</span>
              <div className="stats-bar-track"><div className="stats-bar-fill stats-bar-count"
                style={{height:(safeNum(item.completed)/mostCompleted*100)+'%'}}/></div>
              <span>{shortMonth(item.month)}</span>
            </div>)}</div>
          </div>
          <div className="stats-trend-chart" aria-label={fr?'Paiements enregistrés':'Recorded payments'}>
            <strong>{fr?'Paiements enregistrés':'Recorded payments'}</strong>
            <div className="stats-bars">{trend.map(item=><div key={item.month} className="stats-bar-item">
              <span className="stats-bar-number">{money(item.received_cents)}</span>
              <div className="stats-bar-track"><div className="stats-bar-fill stats-bar-money"
                style={{height:(safeNum(item.received_cents)/mostReceived*100)+'%'}}/></div>
              <span>{shortMonth(item.month)}</span>
            </div>)}</div>
          </div>
        </div>
      </section>

      <section className="stats-subpanel stats-full-panel" aria-labelledby="stats-popular-title">
        <h3 id="stats-popular-title"><BarChart3 size={19}/>{fr?'Coiffures les plus réservées':'Most-booked hairstyles'}</h3>
        <p className="stats-panel-subtitle">{fr
          ?'Rendez-vous en attente, approuvés et terminés pour ce mois'
          :'Pending, approved and completed bookings for this month'}</p>
        {popular.length===0
          ?<p className="stats-empty">{fr?'Aucune coiffure réservée pour ce mois.':'No hairstyles booked in this month.'}</p>
          :<div className="stats-styles">{popular.map((style,index)=><div className="stats-style-row" key={index}>
            <div className="stats-style-label">
              <strong>{fr?style.name_fr:style.name_en}</strong>
              <span>{style.bookings} {fr?'réservations':'bookings'} · {style.completed} {fr?'terminés':'completed'}</span>
            </div>
            <div className="stats-style-track"><div style={{width:(safeNum(style.bookings)/mostBooked*100)+'%'}}/></div>
          </div>)}</div>}
      </section>

      <p className="stats-disclaimer">{fr
        ?'Ces données sont des estimations de gestion, non une comptabilité bancaire ou fiscale. Les paiements sont comptés dans le mois du rendez-vous, même si reçus à une autre date. Les pourboires, les remboursements et les dépenses ne sont pas inclus. Les anciens prix de service peuvent être estimés à partir des tarifs enregistrés lors de la migration.'
        :'These are management figures, not bank-verified accounts or tax reports. Payments are attributed to the appointment month even if received on another date. Tips, refunds and expenses are not included. Older booked prices may reflect the service prices recorded at migration time.'}</p>
    </>}
  </section>;
}
