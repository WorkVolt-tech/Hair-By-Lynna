import React, { useEffect, useMemo, useRef, useState } from 'react';
import { BarChart3, CalendarCheck2, ChevronLeft, ChevronRight, CircleDollarSign, CreditCard, Download, RefreshCw, Trash2, TrendingUp, Wallet } from 'lucide-react';
import { supabase } from './lib/supabase.js';
import { downloadArchiveExcel } from './lib/businessXlsx.js';
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
  // Archive flow: download one Excel file, then (after Lynna confirms) delete those rows.
  const [archive,setArchive]=useState(null);
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
  async function downloadArchive(){
    if(exporting||!supabase)return;
    setExporting('archive');setExportError('');setExportSuccess('');setArchive(null);
    try{
      // One cutoff for every request, so the file, the totals and the delete
      // list all describe exactly the same appointments.
      const cutoff=new Date().toISOString();
      const records=[];
      const pageSize=500,maxRows=25000;
      for(let start=0;start<maxRows;start+=pageSize){
        const {data,error:rowsError}=await supabase.rpc('owner_export_past_appointments',{p_cutoff:cutoff})
          .range(start,start+pageSize-1);
        if(rowsError)throw rowsError;
        if(!Array.isArray(data))throw new Error('Invalid export result');
        records.push(...data);
        if(data.length<pageSize)break;
        if(records.length>=maxRows)throw new Error('Too many records to export');
      }
      if(records.length===0){
        setExportSuccess(fr?'Aucun rendez-vous passé à archiver.':'There are no past appointments to archive.');
        return;
      }
      const {data:totals,error:statsError}=await supabase.rpc('owner_past_business_statistics',{p_cutoff:cutoff});
      if(statsError||!totals)throw new Error('STATS_FAILED');
      const {filename}=downloadArchiveExcel(records,totals,fr);
      setArchive({
        rows:records.map(r=>({id:r.appointment_id,v:r.row_version})),
        count:records.length,period:totals.month,filename
      });
    }catch(e){
      // No customer data or file content is logged on failures.
      setExportError(fr?'Téléchargement impossible. Rien n’a été supprimé. Réessayez.':'Download failed. Nothing was deleted. Please try again.');
    }finally{
      setExporting('');
    }
  }
  async function deleteArchived(){
    if(!archive||exporting||!supabase)return;
    setExporting('delete');setExportError('');
    try{
      const {data,error:deleteError}=await supabase.rpc('owner_delete_archived_appointments',{p_rows:archive.rows});
      if(deleteError||!data)throw deleteError||new Error('DELETE_FAILED');
      const deleted=safeNum(data.deleted),kept=safeNum(data.kept);
      setArchive(null);
      setExportSuccess((fr
        ?deleted+' rendez-vous passé'+(deleted>1?'s':'')+' supprimé'+(deleted>1?'s':'')+' de la base de données.'
        :deleted+' past appointment'+(deleted===1?'':'s')+' deleted from the database.')+
        (kept>0?(fr
          ?' '+kept+' rendez-vous modifié'+(kept>1?'s':'')+' après le téléchargement ont été conservés : téléchargez de nouveau pour les archiver.'
          :' '+kept+' appointment'+(kept===1?' was':'s were')+' changed after the download and kept. Download again to archive '+(kept===1?'it':'them')+'.'):''));
      setRevision(n=>n+1);
    }catch(e){
      setExportError(fr?'Suppression impossible. Vos données sont intactes. Réessayez.':'Delete failed. Your data is unchanged. Please try again.');
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
     hint:fr?'Dépôts et soldes confirmés':'Confirmed deposits and final balances'},
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

    <section className="stats-export" aria-label={fr?'Archiver les rendez-vous passés':'Archive past appointments'}>
      <div className="stats-export-heading">
        <h3><Download size={18}/>{fr?'Télécharger et archiver':'Download & archive'}</h3>
        <p>{fr
          ?'Un seul fichier Excel avec 3 onglets (Rendez-vous, Paiements, Statistiques) contenant tous les rendez-vous déjà terminés, peu importe le mois. Après le téléchargement, vous pourrez les supprimer de la base de données. Les rendez-vous à venir ne sont jamais touchés.'
          :'One Excel file with 3 tabs (Appointments, Payments, Statistics) containing every appointment that has already ended, from any month. After the download you can delete them from the database. Upcoming appointments are never touched.'}</p>
      </div>
      {!archive&&<div className="stats-export-buttons">
        <button type="button" disabled={Boolean(exporting)} onClick={downloadArchive}>
          <Download size={15}/>{exporting==='archive'?(fr?'Préparation…':'Preparing…'):(fr?'Télécharger les rendez-vous passés':'Download past appointments')}
        </button>
      </div>}
      {archive&&<div className="stats-archive-confirm" role="group" aria-label={fr?'Confirmer la suppression':'Confirm deletion'}>
        <p><strong>{fr?'Le fichier a-t-il bien été enregistré?':'Did the file save?'}</strong></p>
        <p>{fr
          ?'Ouvrez « '+archive.filename+' » et vérifiez qu’il contient vos '+archive.count+' rendez-vous ('+archive.period+'). Gardez-le en lieu sûr : ce sera votre seule copie.'
          :'Open “'+archive.filename+'” and check it contains your '+archive.count+' appointment'+(archive.count===1?'':'s')+' ('+archive.period+'). Keep it somewhere safe: it will be your only copy.'}</p>
        <div className="stats-export-buttons">
          <button type="button" className="stats-archive-delete" disabled={Boolean(exporting)} onClick={deleteArchived}>
            <Trash2 size={15}/>{exporting==='delete'?(fr?'Suppression…':'Deleting…'):(fr
              ?'Oui, fichier enregistré. Supprimer '+archive.count+' rendez-vous'
              :'Yes, file saved. Delete '+archive.count+' appointment'+(archive.count===1?'':'s'))}
          </button>
          <button type="button" disabled={Boolean(exporting)} onClick={downloadArchive}>
            <Download size={15}/>{fr?'Télécharger de nouveau':'Download again'}
          </button>
          <button type="button" disabled={Boolean(exporting)} onClick={()=>setArchive(null)}>
            {fr?'Pas maintenant':'Not now'}
          </button>
        </div>
        <p className="stats-export-privacy">{fr?'La suppression est définitive.':'Deleting cannot be undone.'}</p>
      </div>}
      <p className="stats-export-privacy">{fr
        ?'Privé : le fichier comprend des noms et des courriels clients. Conservez-le en sécurité (au moins 6 ans pour les dossiers d’entreprise). Les remboursements ne sont pas comptabilisés.'
        :'Private: the file includes customer names and emails. Store it securely (business records should be kept at least 6 years). Refunds are not tracked.'}</p>
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
          <div className="stats-payments-row"><span>{fr?'Dépôts reçus':'Deposits received'}</span><strong>{money(stats.deposit_received_cents)}</strong></div>
          <div className="stats-payments-row"><span>{fr?'Paiements finaux reçus':'Final payments received'}</span><strong>{money(stats.final_received_cents)}</strong></div>
          <div className="stats-payments-row stats-payments-total"><span>{fr?'Total enregistré':'Total recorded'}</span><strong>{money(stats.total_received_cents)}</strong></div>
          <p className="stats-panel-footnote">{fr
            ?'Les dépôts incluent ceux des rendez-vous annulés ou refusés, s’ils sont encore marqués reçus. Les remboursements ne sont pas suivis.'
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
