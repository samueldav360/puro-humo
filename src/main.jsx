import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { supabase, isConfigured } from './supabase';
import { Home, Flag, Scale, BookOpen, Settings, LogOut, Crown, Clock3, Plus, Check, X, RefreshCw, ShieldCheck, Gavel, ArrowUpRight, ArrowDownRight, Landmark, Users, LockKeyhole } from 'lucide-react';
import './styles.css';

const money = n => new Intl.NumberFormat('es-CO').format(Number(n || 0));
const stamp = d => new Date(d).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' });
const errorText = e => e?.message || 'No fue posible completar la operación.';

function App() {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [group, setGroup] = useState(null);
  const [page, setPage] = useState('home');
  const [data, setData] = useState({ challenges: [], submissions: [], auctions: [], bids: [], history: [], groups: [] });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [authMode, setAuthMode] = useState('login');
  const [auth, setAuth] = useState({ email: '', password: '', code: '' });
  const [forms, setForms] = useState({});
  const isAdmin = profile?.role === 'admin';
  const set = (k, v) => setForms(s => ({ ...s, [k]: v }));
  const say = msg => { setNotice(msg); window.clearTimeout(say.timer); say.timer = window.setTimeout(() => setNotice(''), 4200); };

  useEffect(() => {
    if (!supabase) { setLoading(false); return; }
    supabase.auth.getSession().then(({ data: d }) => setSession(d.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) { setProfile(null); setGroup(null); setData({ challenges: [], submissions: [], auctions: [], bids: [], history: [], groups: [] }); setLoading(false); return; }
    loadAll();
    const channel = supabase.channel('puro-humo-live')
      .on('postgres_changes', { event: '*', schema: 'public' }, () => loadAll())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [session]);

  async function loadAll() {
    setLoading(true);
    try {
      const { data: p, error: pe } = await supabase.from('profiles').select('user_id,display_name,role,group_id').eq('user_id', session.user.id).single();
      if (pe) throw pe;
      setProfile(p);
      if (p.group_id) {
        const { data: g, error: ge } = await supabase.from('groups').select('id,name,points').eq('id', p.group_id).single();
        if (ge) throw ge; setGroup(g);
      } else setGroup(null);
      const [c, s, a, h, gs] = await Promise.all([
        supabase.from('challenges').select('*').order('created_at', { ascending: false }),
        supabase.from('challenge_submissions').select('*, challenges(title,reward_points), groups(name)').order('created_at', { ascending: false }),
        supabase.from('auctions').select('*').order('created_at', { ascending: false }),
        supabase.from('point_transactions').select('*, groups(name)').order('created_at', { ascending: false }).limit(100),
        p.role === 'admin' ? supabase.from('groups').select('id,name,points,created_at').order('name') : Promise.resolve({ data: [] })
      ]);
      for (const r of [c,s,a,h,gs]) if (r.error) throw r.error;
      setData({ challenges: c.data || [], submissions: s.data || [], auctions: a.data || [], history: h.data || [], groups: gs.data || [] });
    } catch (e) { say(errorText(e)); }
    finally { setLoading(false); }
  }

  async function run(fn, success) {
    if (busy) return;
    setBusy(true);
    try { await fn(); say(success); await loadAll(); }
    catch (e) { say(errorText(e)); }
    finally { setBusy(false); }
  }

  async function authenticate(e) {
    e.preventDefault(); setBusy(true);
    try {
      if (authMode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email: auth.email.trim(), password: auth.password });
        if (error) throw error;
      } else {
        const { data: result, error } = await supabase.auth.signUp({ email: auth.email.trim(), password: auth.password, options: { data: { display_name: auth.email.split('@')[0] } } });
        if (error) throw error;
        if (result.session && auth.code.trim()) {
          const { error: joinError } = await supabase.rpc('join_group', { p_invite_code: auth.code.trim() });
          if (joinError) throw joinError;
        } else if (!result.session) say('Cuenta creada. Confirma tu correo y luego inicia sesión para ingresar el código de tu grupo.');
      }
    } catch (e) { say(errorText(e)); }
    finally { setBusy(false); }
  }

  async function joinGroup(e) { e.preventDefault(); await run(async () => { const { error } = await supabase.rpc('join_group', { p_invite_code: (forms.invite || '').trim() }); if (error) throw error; }, 'Te has unido al grupo.'); }
  async function createGroup(e) { e.preventDefault(); await run(async () => { const { error } = await supabase.rpc('admin_create_group', { p_name: forms.groupName, p_initial_points: Number(forms.initialPoints || 0), p_invite_code: forms.inviteCode }); if (error) throw error; setForms(s => ({ ...s, groupName: '', initialPoints: '0', inviteCode: '' })); }, 'Grupo creado. Guarda el código de acceso y compártelo únicamente con sus integrantes.'); }
  async function adjustPoints(e, sign) { e.preventDefault(); await run(async () => { const { error } = await supabase.rpc('admin_adjust_points', { p_group_id: forms.adjustGroup, p_amount: Number(forms.adjustAmount), p_reason: forms.adjustReason || 'Ajuste administrativo', p_direction: sign }); if (error) throw error; }, 'Movimiento de puntos registrado.'); }
  async function createChallenge(e) { e.preventDefault(); await run(async () => { const { error } = await supabase.from('challenges').insert({ title: forms.challengeTitle, description: forms.challengeDescription, reward_points: Number(forms.challengeReward), active: true }); if (error) throw error; setForms(s => ({ ...s, challengeTitle: '', challengeDescription: '', challengeReward: '' })); }, 'Reto publicado.'); }
  async function submitChallenge(e, id) { e.preventDefault(); await run(async () => { const { error } = await supabase.rpc('submit_challenge', { p_challenge_id: id, p_note: forms[`note_${id}`] || '' }); if (error) throw error; }, 'Solicitud enviada al staff para validación.'); }
  async function reviewSubmission(id, approve) { await run(async () => { const { error } = await supabase.rpc('review_challenge_submission', { p_submission_id: id, p_approve: approve }); if (error) throw error; }, approve ? 'Reto aprobado y puntos acreditados.' : 'Solicitud rechazada.'); }
  async function createAuction(e) { e.preventDefault(); await run(async () => { const { error } = await supabase.from('auctions').insert({ title: forms.auctionTitle, description: forms.auctionDescription, starting_bid: Number(forms.startingBid), current_bid: Number(forms.startingBid), status: 'open' }); if (error) throw error; setForms(s => ({ ...s, auctionTitle: '', auctionDescription: '', startingBid: '' })); }, 'Subasta abierta.'); }
  async function bid(e, id) { e.preventDefault(); await run(async () => { const { error } = await supabase.rpc('place_bid', { p_auction_id: id, p_amount: Number(forms[`bid_${id}`]) }); if (error) throw error; }, 'Oferta registrada.'); }
  async function closeAuction(id) { await run(async () => { const { error } = await supabase.rpc('close_auction', { p_auction_id: id }); if (error) throw error; }, 'Subasta cerrada y adjudicación procesada.'); }

  if (!isConfigured) return <Setup />;
  if (!session) return <Auth auth={auth} setAuth={setAuth} mode={authMode} setMode={setAuthMode} submit={authenticate} busy={busy} notice={notice} />;
  const nav = [ ['home','Inicio',Home], ['challenges','Retos',Flag], ['auctions','Subastas',Scale], ['history','Historial',BookOpen], ...(isAdmin ? [['admin','Administración',Settings]] : []) ];
  return <div className="app-shell">
    <aside className="sidebar"><div className="brand"><div className="seal">H</div><div className="brand-name">PURO HUMO</div><div className="brand-tag">UNA INSTITUCIÓN COMPLETAMENTE INNECESARIA</div></div>
      <nav>{nav.map(([id,label,Icon]) => <button key={id} className={page===id?'selected':''} onClick={()=>setPage(id)}><Icon size={17}/>{label}</button>)}</nav>
      <div className="side-bottom"><div className="side-event">EVENTO HAVEN<br/><span>DOS DÍAS DE GLORIA DUDOSA</span></div><button className="logout" onClick={()=>supabase.auth.signOut()}><LogOut size={16}/> Cerrar sesión</button></div>
    </aside>
    <main className="main"><header className="topbar"><button className="secondary refresh-button" onClick={loadAll} title="Actualizar información"><RefreshCw size={14}/> Actualizar</button><div className="user-meta"><span className="role"><ShieldCheck size={14}/>{isAdmin?'Administración':'Miembro distinguido'}</span><span>{profile?.display_name || session.user.email}</span></div>{group && <div className="balance"><span>{group.name}</span><b>{money(group.points)} humos</b></div>}</header>
      {notice && <div className="toast" role="status">{notice}</div>}
      {loading ? <div className="loading"><RefreshCw className="spin"/> Cargando la institución…</div> : !group && !isAdmin ? <JoinGroup forms={forms} set={set} submit={joinGroup} busy={busy}/> : <>
        {page==='home' && <HomePage group={group} data={data} isAdmin={isAdmin} go={setPage}/>}
        {page==='challenges' && <Challenges data={data} group={group} isAdmin={isAdmin} forms={forms} set={set} create={createChallenge} submit={submitChallenge} review={reviewSubmission} busy={busy}/>}
        {page==='auctions' && <Auctions data={data} group={group} isAdmin={isAdmin} forms={forms} set={set} create={createAuction} bid={bid} close={closeAuction} busy={busy}/>}
        {page==='history' && <History data={data}/>}
        {page==='admin' && isAdmin && <Admin data={data} forms={forms} set={set} createGroup={createGroup} adjust={adjustPoints} busy={busy}/>}
      </>}
    </main>
  </div>;
}

function Setup(){return <div className="auth-wrap"><div className="auth-card"><div className="seal">H</div><p className="eyebrow">Configuración inicial</p><h1>PURO HUMO</h1><p className="muted">La aplicación necesita las credenciales públicas de tu proyecto Supabase para conectarse.</p><ol className="setup-list"><li>Copia <code>.env.example</code> como <code>.env</code>.</li><li>Completa <code>VITE_SUPABASE_URL</code> y <code>VITE_SUPABASE_ANON_KEY</code> con la URL y la clave Publishable (o anon) de Supabase.</li><li>Ejecuta el SQL incluido en <code>supabase/migrations/001_initial_schema.sql</code> desde el SQL Editor de Supabase.</li></ol><p className="muted">Nunca coloques una clave <code>service_role</code> en esta aplicación.</p></div></div>}
function Auth({auth,setAuth,mode,setMode,submit,busy,notice}){return <div className="auth-wrap"><div className="auth-card"><div className="seal">H</div><p className="eyebrow">Acceso concedido · Haven</p><h1>PURO HUMO</h1><p className="subtitle">La seriedad es opcional. Las consecuencias, no.</p>{notice&&<div className="notice">{notice}</div>}<form onSubmit={submit} className="stack"><label>Correo electrónico<input required type="email" value={auth.email} onChange={e=>setAuth(s=>({...s,email:e.target.value}))} autoComplete="email"/></label><label>Contraseña<input required minLength="8" type="password" value={auth.password} onChange={e=>setAuth(s=>({...s,password:e.target.value}))} autoComplete={mode==='login'?'current-password':'new-password'}/></label>{mode==='signup'&&<label>Código de acceso del grupo <span className="optional">(puedes ingresarlo después)</span><input value={auth.code} onChange={e=>setAuth(s=>({...s,code:e.target.value}))} autoComplete="off"/></label>}<button className="primary wide" disabled={busy}>{busy?'Procesando…':mode==='login'?'Entrar a la institución':'Crear cuenta'}</button></form><button className="text-button" onClick={()=>setMode(mode==='login'?'signup':'login')}>{mode==='login'?'¿Tu grupo aún no tiene cuenta? Crear una':'Ya tienes cuenta. Iniciar sesión'}</button><p className="fine">Acceso privado para participantes y staff.</p></div></div>}
function JoinGroup({forms,set,submit,busy}){return <div className="content narrow"><Heading eyebrow="Registro de casa" title="Todavía no perteneces a una casa" intro="Solicita al staff el código de acceso de tu grupo para incorporarte."/><form className="card stack" onSubmit={submit}><label>Código de acceso<input required value={forms.invite||''} onChange={e=>set('invite',e.target.value)} autoComplete="off"/></label><button className="primary" disabled={busy}>Unirme a mi grupo</button></form></div>}
function Heading({eyebrow,title,intro}){return <div className="page-heading"><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p className="page-intro">{intro}</p></div>}
function HomePage({group,data,isAdmin,go}){const active=data.challenges.filter(x=>x.active).length;const open=data.auctions.filter(x=>x.status==='open').length;return <div className="content"><div className="hero"><div><p className="eyebrow">Acceso concedido · Haven</p><h1>PURO HUMO</h1><p className="subtitle">Bienvenido, distinguido individuo.</p><p className="small-note">La seriedad es opcional. Las consecuencias, no.</p></div></div><div className="stats"><Stat icon={<Landmark/>} label="Su patrimonio imaginario" value={`${money(group?.points)} humos`}/><Stat icon={<Flag/>} label="Encargos disponibles" value={active}/><Stat icon={<Clock3/>} label="Subastas abiertas" value={open}/></div><div className="two-col"><div className="card"><div className="card-head"><h2>Encargos de dudosa importancia</h2><button className="secondary" onClick={()=>go('challenges')}>Ver todos <ArrowUpRight size={14}/></button></div>{data.challenges.filter(x=>x.active).slice(0,3).map(x=><div className="simple-row" key={x.id}><div><b>{x.title}</b><p>{x.description}</p></div><strong>+{money(x.reward_points)}</strong></div>)}{!active&&<Empty>No hay encargos activos por ahora.</Empty>}</div><div className="card"><div className="card-head"><h2>Casa de subastas</h2><button className="secondary" onClick={()=>go('auctions')}>Ingresar <ArrowUpRight size={14}/></button></div>{data.auctions.filter(x=>x.status==='open').slice(0,3).map(x=><div className="simple-row" key={x.id}><div><b>{x.title}</b><p>{x.description}</p></div><strong>{money(x.current_bid)} humos</strong></div>)}{!open&&<Empty>La sala permanece cerrada. La administración está ocupada pareciendo importante.</Empty>}</div></div><div className="card recent"><div className="card-head"><h2>Últimos movimientos</h2><button className="secondary" onClick={()=>go('history')}>Libro mayor <ArrowUpRight size={14}/></button></div><TransactionList rows={data.history.filter(x=>!group||x.group_id===group.id).slice(0,5)}/></div>{isAdmin&&<p className="admin-hint"><Crown size={14}/> Estás viendo la plataforma con permisos de administración.</p>}</div>}
function Stat({icon,label,value}){return <div className="card stat"><div className="stat-icon">{icon}</div><div><div className="stat-label">{label}</div><div className="stat-value">{value}</div></div></div>}
function Challenges({data,group,isAdmin,forms,set,create,submit,review,busy}){const own=data.submissions.filter(x=>x.group_id===group?.id);return <div className="content"><Heading eyebrow="Encargos oficiales" title="Retos" intro="Cumpla el encargo. El staff verificará cada solicitud antes de acreditar los humos."/>{isAdmin&&<form className="card stack form-card" onSubmit={create}><h2><Plus size={17}/> Publicar un reto</h2><div className="form-grid"><label>Nombre del reto<input required value={forms.challengeTitle||''} onChange={e=>set('challengeTitle',e.target.value)}/></label><label>Recompensa en humos<input required type="number" min="1" step="1" value={forms.challengeReward||''} onChange={e=>set('challengeReward',e.target.value)}/></label></div><label>Descripción<textarea required rows="2" value={forms.challengeDescription||''} onChange={e=>set('challengeDescription',e.target.value)}/></label><button className="primary" disabled={busy}>Publicar reto</button></form>}<div className="cards">{data.challenges.map(c=>{const mine=own.find(s=>s.challenge_id===c.id);return <article className="card challenge-card" key={c.id}><div className="card-top"><span className="eyebrow">Encargo institucional</span><span className="reward">+{money(c.reward_points)} humos</span></div><h2>{c.title}</h2><p>{c.description}</p>{!isAdmin&&c.active&&<form className="stack" onSubmit={e=>submit(e,c.id)}><label>Comentario para el staff <textarea rows="2" value={forms[`note_${c.id}`]||''} onChange={e=>set(`note_${c.id}`,e.target.value)} placeholder="Describe brevemente cómo completaste el reto…"/></label><button className="primary" disabled={busy||!!mine}>{mine?'Solicitud enviada': 'Enviar solicitud'}</button></form>}{mine&&<span className={`status ${mine.status}`}>{mine.status==='pending'?'Pendiente de revisión':mine.status==='approved'?'Aprobado':'No aprobado'}</span>}{isAdmin&&<span className={`status ${c.active?'open':'closed'}`}>{c.active?'Activo':'Inactivo'}</span>}</article>})}</div>{isAdmin&&<div className="card recent"><div className="card-head"><h2>Solicitudes pendientes</h2><span className="count">{data.submissions.filter(x=>x.status==='pending').length}</span></div>{data.submissions.filter(x=>x.status==='pending').map(s=><div className="review-row" key={s.id}><div><b>{s.groups?.name||'Grupo' } · {s.challenges?.title}</b><p>{s.note||'Sin comentario adicional'}</p></div><div className="actions"><button className="approve" onClick={()=>review(s.id,true)} disabled={busy}><Check size={15}/> Aprobar</button><button className="reject" onClick={()=>review(s.id,false)} disabled={busy}><X size={15}/> Rechazar</button></div></div>)}{!data.submissions.some(x=>x.status==='pending')&&<Empty>No hay solicitudes pendientes.</Empty>}</div>}</div>}
function Auctions({data,group,isAdmin,forms,set,create,bid,close,busy}){return <div className="content"><Heading eyebrow="Mercado de privilegios" title="Casa de subastas" intro="Las ventajas internas se adjudican con humos. No hay azar: solo ofertas, reglas y una administración observando."/>{isAdmin&&<form className="card stack form-card" onSubmit={create}><h2><Plus size={17}/> Publicar una ventaja</h2><div className="form-grid"><label>Nombre de la ventaja<input required value={forms.auctionTitle||''} onChange={e=>set('auctionTitle',e.target.value)}/></label><label>Oferta inicial<input required type="number" min="1" step="1" value={forms.startingBid||''} onChange={e=>set('startingBid',e.target.value)}/></label></div><label>Descripción y condiciones<textarea required rows="2" value={forms.auctionDescription||''} onChange={e=>set('auctionDescription',e.target.value)}/></label><button className="primary" disabled={busy}>Abrir subasta</button></form>}<div className="cards">{data.auctions.map(a=><article className="card auction-card" key={a.id}><div className="card-top"><span className={`status ${a.status}`}>{a.status==='open'?'Abierta':a.status==='closed'?'Cerrada':'Adjudicada'}</span><span className="muted">Oferta actual</span></div><h2>{a.title}</h2><p>{a.description}</p><div className="bid-value">{money(a.current_bid)} <small>humos</small></div>{a.status==='open'&&!isAdmin&&<form className="bid-form" onSubmit={e=>bid(e,a.id)}><input required type="number" min={Number(a.current_bid)+1} step="1" placeholder="Tu oferta" value={forms[`bid_${a.id}`]||''} onChange={e=>set(`bid_${a.id}`,e.target.value)}/><button className="primary" disabled={busy}>Ofertar</button></form>}{a.status==='open'&&isAdmin&&<button className="primary" onClick={()=>close(a.id)} disabled={busy}><Gavel size={15}/> Cerrar y adjudicar</button>}{a.status!=='open'&&a.winner_group_id&&<p className="muted">Ventaja adjudicada al grupo ganador.</p>}</article>)}</div>{!data.auctions.length&&<div className="card"><Empty>La sala permanece cerrada. Aún no hay ventajas publicadas.</Empty></div>}</div>}
function History({data}){return <div className="content"><Heading eyebrow="Registro institucional" title="Historial" intro="Cada movimiento de puntos queda registrado para mantener las cuentas claras."/><div className="card"><TransactionList rows={data.history} detailed/></div></div>}
function TransactionList({rows,detailed=false}){if(!rows?.length)return <Empty>No hay movimientos registrados.</Empty>;return <div>{rows.map(r=><div className="transaction" key={r.id}><span className={`transaction-icon ${r.amount>=0?'up':'down'}`}>{r.amount>=0?<ArrowUpRight size={16}/>:<ArrowDownRight size={16}/>}</span><div className="transaction-info"><b>{r.description}</b><span>{r.groups?.name||'Grupo'} · {stamp(r.created_at)}</span></div><strong className={r.amount>=0?'positive':'negative'}>{r.amount>0?'+':''}{money(r.amount)}{detailed?' humos':''}</strong></div>)}</div>}
function Admin({data,forms,set,createGroup,adjust,busy}){return <div className="content"><Heading eyebrow="Control interno" title="Administración" intro="Herramientas reservadas al staff. Todas las operaciones sensibles se validan en la base de datos."/><form className="card stack form-card" onSubmit={createGroup}><h2><Users size={17}/> Registrar una casa</h2><div className="form-grid"><label>Nombre del grupo<input required value={forms.groupName||''} onChange={e=>set('groupName',e.target.value)}/></label><label>Saldo inicial<input required type="number" min="0" step="1" value={forms.initialPoints??'0'} onChange={e=>set('initialPoints',e.target.value)}/></label></div><label>Código de invitación (compártelo solo con ese grupo)<input required minLength="6" value={forms.inviteCode||''} onChange={e=>set('inviteCode',e.target.value)}/></label><button className="primary" disabled={busy}>Crear grupo y código</button></form><form className="card stack form-card" onSubmit={e=>adjust(e,1)}><h2><Plus size={17}/> Ajustar puntos</h2><div className="form-grid"><label>Grupo<select required value={forms.adjustGroup||''} onChange={e=>set('adjustGroup',e.target.value)}><option value="">Seleccionar grupo</option>{data.groups.map(g=><option key={g.id} value={g.id}>{g.name}</option>)}</select></label><label>Cantidad<input required type="number" min="1" step="1" value={forms.adjustAmount||''} onChange={e=>set('adjustAmount',e.target.value)}/></label></div><label>Motivo del movimiento<input required value={forms.adjustReason||''} onChange={e=>set('adjustReason',e.target.value)}/></label><div className="row-actions"><button className="primary" disabled={busy}>Acreditar puntos</button><button type="button" className="danger" disabled={busy} onClick={e=>adjust(e,-1)}>Descontar puntos</button></div></form><div className="card recent"><div className="card-head"><h2>Resumen de casas</h2><span className="count">{data.groups.length}</span></div>{data.groups.length?<div className="group-table">{data.groups.map(g=><div className="group-line" key={g.id}><span>{g.name}</span><b>{money(g.points)} humos</b></div>)}</div>:<Empty>Aún no hay grupos registrados.</Empty>}</div></div>}
function Empty({children}){return <div className="empty">{children}</div>}

createRoot(document.getElementById('root')).render(<App/>);
