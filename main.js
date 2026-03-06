// ── STATE ─────────────────────────────────────────────
let allRows   = [];   // todas as linhas do CSV (com dateObj parseada)
let venc30    = [];   // vencidos com dias >= 30
let venc60    = [];   // vencidos com dias >= 60
let venc120   = [];   // vencidos com dias >= 120
let summ      = null; // resumo calculado após filtro de data
let dateMin   = null; // menor data de vencimento do dataset
let dateMax   = null; // maior data de vencimento do dataset
let dfFrom    = null; // início do filtro ativo
let dfTo      = null; // fim do filtro ativo
let activeQuick = 'all';

// estado por aba de detalhes
const detState = {
  30:  {filt:'all', page:1, sort:{c:'dias',d:-1}, search:''},
  60:  {filt:'all', page:1, sort:{c:'dias',d:-1}, search:''},
  120: {filt:'all', page:1, sort:{c:'dias',d:-1}, search:''},
};
const PG = 20;
const TAB_TO_BAND = {d30:30,d60:60,d120:120};
const GENERAL_CARD_CONFIG = {
  total: {
    label: 'Total Faturado',
    valueLabel: 'Valor Original',
    color: 'var(--accent)',
    colorSoft: 'var(--accent-s)',
    valueFn: row => row.valor || 0,
    baseFilter: () => true,
  },
  recebidas: {
    label: 'Contas Recebidas',
    valueLabel: 'Valor Recebido',
    color: 'var(--green)',
    colorSoft: 'var(--green-s)',
    valueFn: row => row.baixado || 0,
    baseFilter: row => /baixado/i.test(row.stat || ''),
  },
  vencidas: {
    label: 'Em Aberto / Vencido',
    valueLabel: 'Valor em Aberto',
    color: 'var(--red)',
    colorSoft: 'var(--red-s)',
    valueFn: row => row.valor || 0,
    baseFilter: row => /vencido/i.test(row.stat || ''),
  },
  canceladas: {
    label: 'Cancelados',
    valueLabel: 'Valor Cancelado',
    color: 'var(--text3)',
    colorSoft: 'var(--surface2)',
    valueFn: row => row.valor || 0,
    baseFilter: row => /cancel/i.test(row.stat || ''),
  },
};

const GENERAL_STATUS_FILTERS = [
  {k:'all', lbl:'Todos'},
  {k:'baixado', lbl:'Baixados'},
  {k:'vencido', lbl:'Vencidos'},
  {k:'cancelado', lbl:'Cancelados'},
];

const generalState = {
  open: false,
  card: 'total',
  statusFilter: 'all',
  search: '',
  sort: {c:'valor', d:-1},
  page: 1,
};

// ── UTILS ─────────────────────────────────────────────
const R = n => 'R$ ' + Number(n).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
const P = (a,b) => b ? (a/b*100).toLocaleString('pt-BR',{minimumFractionDigits:1,maximumFractionDigits:1})+'%' : '0,0%';
const toISO = d => d ? d.toISOString().slice(0,10) : '';
const fmtDate = d => d ? d.toLocaleDateString('pt-BR') : '';
const normalizeText = v => String(v||'').toLowerCase().trim().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
const normalizeDoc = v => String(v||'').replace(/\D/g,'');
const DAY_MS = 24 * 60 * 60 * 1000;

function rowMatchesSearch(row, query) {
  const qText = normalizeText(query);
  if (!qText) return true;

  const qDoc = normalizeDoc(query);
  const nome = normalizeText(row.nome);
  const hist = normalizeText(row.historico);
  const cnpjText = normalizeText(row.cnpj);
  const cnpjDoc = normalizeDoc(row.cnpj);

  const textMatch = nome.includes(qText) || hist.includes(qText) || cnpjText.includes(qText);
  const docMatch = qDoc && cnpjDoc.includes(qDoc);
  return textMatch || docMatch;
}

function isDateFilterActive() {
  return (dfFrom && dateMin && toISO(dfFrom) > toISO(dateMin)) ||
         (dfTo   && dateMax && toISO(dfTo)   < toISO(dateMax));
}

function setQuickButton(activeKey) {
  $('.dfqbtn').removeClass('on');
  if (activeKey) $(`#dq-${activeKey}`).addClass('on');
}

function setActiveTab(tabId) {
  $('.tab').removeClass('active');
  $(`.tab[data-tab="${tabId}"]`).addClass('active');
  $('.tc').removeClass('active');
  $(`#tab-${tabId}`).addClass('active');
}

function parseCsvFile(file) {
  Papa.parse(file,{
    header:true,
    skipEmptyLines:true,
    encoding:'ISO-8859-1',
    complete:processCSV,
    error:()=>showToast('❌ Erro ao ler o arquivo')
  });
}

function handleCsvFile(file, invalidMsg) {
  if (!file) return;
  if (!file.name.endsWith('.csv')) {
    showToast(invalidMsg);
    return;
  }
  parseCsvFile(file);
}

function showToast(msg) {
  $('#toast').text(msg).addClass('on');
  setTimeout(()=>$('#toast').removeClass('on'), 3200);
}

function parseR(v) {
  if (v==null) return 0;
  const s = String(v).replace(/R\$|\s/g,'').replace(/\./g,'').replace(',','.').trim();
  if (!s||s==='-') return 0;
  return parseFloat(s)||0;
}

function hasYearInDateStr(v) {
  if (!v || typeof v !== 'string') return false;
  const s = v.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ||
         /^(\d{1,2})\/(\d{2})\/(\d{4})$/.test(s) ||
         /^(\d{1,2})\/([a-zç]{3})\/(\d{4})$/i.test(s);
}

function calcDiasAtraso(vencStr, dateObj, fallback=0) {
  if (!dateObj) return fallback;
  if (!hasYearInDateStr(vencStr)) return fallback;

  const hoje = new Date();
  hoje.setHours(0,0,0,0);

  const venc = new Date(dateObj);
  venc.setHours(0,0,0,0);

  const diff = Math.floor((hoje - venc) / DAY_MS);
  return Math.max(0, diff);
}

// Faz parse de datas brasileiras como "30/ago", "01/jan/2024", "31/12/2022", etc.
const MONTHS = {jan:0,fev:1,mar:2,abr:3,mai:4,jun:5,jul:6,ago:7,set:8,out:9,nov:10,dez:11};
function parseDateStr(s) {
  if (!s||typeof s!=='string') return null;
  s = s.trim();
  // ISO format: 2022-12-31
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) { const d=new Date(s+'T00:00:00'); return isNaN(d)?null:d; }
  // dd/mm/yyyy
  const m1 = s.match(/^(\d{1,2})\/(\d{2})\/(\d{4})$/);
  if (m1) return new Date(+m1[3],+m1[2]-1,+m1[1]);
  // dd/mm (no year — use a reference year, we only need relative ordering)
  const m2 = s.match(/^(\d{1,2})\/(\d{2})$/);
  if (m2) return new Date(2020,+m2[2]-1,+m2[1]);
  // dd/mmm  e.g. "30/ago"
  const m3 = s.match(/^(\d{1,2})\/([a-zç]{3})$/i);
  if (m3) { const mo=MONTHS[m3[2].toLowerCase()]; if(mo!==undefined) return new Date(2020,mo,+m3[1]); }
  // dd/mmm/yyyy
  const m4 = s.match(/^(\d{1,2})\/([a-zç]{3})\/(\d{4})$/i);
  if (m4) { const mo=MONTHS[m4[2].toLowerCase()]; if(mo!==undefined) return new Date(+m4[3],mo,+m4[1]); }
  return null;
}

function bandOf(dias) {
  if (dias<=180) return {bg:'var(--yellow-s)',c:'var(--yellow)',lbl:'120–180 dias'};
  if (dias<=365) return {bg:'var(--orange-s)',c:'var(--orange)',lbl:'180–365 dias'};
  return {bg:'var(--red-s)',c:'var(--red)',lbl:'+365 dias'};
}

// ── CSV PARSE ─────────────────────────────────────────
function processCSV(res) {
  const rows = res.data;
  if (!rows.length) { showToast('❌ Arquivo vazio'); return; }

  const rawCols = Object.keys(rows[0]);
  const n = normalizeText;
  const fc = (...aliases) => rawCols.find(k => aliases.some(a => n(k).includes(n(a))));

  const cNome  = fc('nome','cliente','razao social');
  const cCNPJ  = fc('cnpj','cpf','documento');
  const cStat  = fc('status');
  const cVenc  = fc('data de vencimento','vencimento','data venc');
  const cDias  = fc('dias em atraso','dias atraso','dias');
  const cVOrig = fc('valor original','valor orig');
  const cVBx   = fc('valor baixado','vlr baixado');
  const cHist  = fc('historico','descricao','hist');
  const cSit   = fc('situacao atual','situacao','situação atual');

  if (!cNome || !cStat) {
    showToast('⚠️ Colunas "Nome" e "Status" não encontradas. Verifique o arquivo.');
    return;
  }

  allRows = [];
  let minDate=null, maxDate=null;

  rows.forEach(r => {
    const nome = (r[cNome]||'').trim();
    if (!nome) return;
    const val   = parseR(r[cVOrig]);
    const bxd   = parseR(r[cVBx]);
    const stat  = (r[cStat]||'').trim();
    const vencStr = (r[cVenc]||'').trim();
    const dateObj = parseDateStr(vencStr);
    const diasCsv = parseInt(r[cDias],10)||0;
    const dias = calcDiasAtraso(vencStr, dateObj, diasCsv);

    if (dateObj) {
      if (!minDate || dateObj < minDate) minDate = dateObj;
      if (!maxDate || dateObj > maxDate) maxDate = dateObj;
    }

    allRows.push({
      nome, cnpj:(r[cCNPJ]||'').trim(),
      vencimento:vencStr, dateObj,
      diasCsv,
      dias, valor:val, baixado:bxd,
      stat, historico:(r[cHist]||'').trim(),
      situacao:(r[cSit]||'').trim(),
    });
  });

  dateMin = minDate;
  dateMax = maxDate;
  dfFrom  = minDate;
  dfTo    = maxDate;
  activeQuick = 'all';

  applyDateFilter();
  initDateBar();
  showToast(`✅ ${allRows.length.toLocaleString('pt-BR')} registros importados com sucesso`);
}

// ── DATE FILTER ───────────────────────────────────────
function initDateBar() {
  $('#dfbar').addClass('visible');
  if (dateMin) $('#df-from').val(toISO(dateMin)).attr('min',toISO(dateMin)).attr('max',toISO(dateMax));
  if (dateMax) $('#df-to').val(toISO(dateMax)).attr('min',toISO(dateMin)).attr('max',toISO(dateMax));
  updateRangeInfo();
  setQuickButton('all');
  $('#df-clear').hide();
}

function updateRangeInfo() {
  if (dateMin && dateMax) {
    $('#df-range-info').text(`Dados: ${fmtDate(dateMin)} — ${fmtDate(dateMax)}`);
  }
}

function onDateInput() {
  const from = $('#df-from').val();
  const to   = $('#df-to').val();
  dfFrom = from ? new Date(from+'T00:00:00') : dateMin;
  dfTo   = to   ? new Date(to+'T23:59:59')  : dateMax;
  activeQuick = '';
  setQuickButton('');
  $('#df-clear').toggle(isDateFilterActive());
  applyDateFilter();
}

function setQuick(q) {
  activeQuick = q;
  setQuickButton(q);
  const now = dateMax || new Date();
  let from = dateMin;

  if (q==='3m') {
    from = new Date(now);
    from.setMonth(from.getMonth()-3);
  } else if (q==='6m') {
    from = new Date(now);
    from.setMonth(from.getMonth()-6);
  } else if (q==='1a') {
    from = new Date(now);
    from.setFullYear(from.getFullYear()-1);
  } else if (q==='2a') {
    from = new Date(now);
    from.setFullYear(from.getFullYear()-2);
  } else if (q==='all') {
    from = dateMin;
  }

  dfFrom = from;
  dfTo   = dateMax;
  $('#df-from').val(dfFrom ? toISO(dfFrom) : '');
  $('#df-to').val(dfTo ? toISO(dfTo) : '');
  $('#df-clear').toggle(q!=='all');
  applyDateFilter();
}

function clearDateFilter() {
  dfFrom = dateMin;
  dfTo   = dateMax;
  activeQuick = 'all';
  setQuickButton('all');
  $('#df-from').val(toISO(dateMin));
  $('#df-to').val(toISO(dateMax));
  $('#df-clear').hide();
  applyDateFilter();
}

function rowInDateRange(r) {
  if (!dfFrom && !dfTo) return true;
  if (!r.dateObj) return true; // sem data, mantém no resultado
  if (dfFrom && r.dateObj < dfFrom) return false;
  if (dfTo   && r.dateObj > dfTo)   return false;
  return true;
}

function applyDateFilter() {
  // Recalcula "dias em atraso" com base na data atual.
  allRows.forEach(r => {
    r.dias = calcDiasAtraso(r.vencimento, r.dateObj, r.diasCsv||0);
  });

  const filtered = allRows.filter(rowInDateRange);
  let totFat=0,totRec=0,totVenc=0,totCanc=0;
  let nBx=0,nVenc=0,nCanc=0;
  const allVenc = [];

  filtered.forEach(r => {
    totFat += r.valor;
    if (/baixado/i.test(r.stat))      { totRec += r.baixado; nBx++; }
    else if (/cancel/i.test(r.stat))  { totCanc += r.valor; nCanc++; }
    else if (/vencido/i.test(r.stat)) {
      totVenc += r.valor; nVenc++;
      allVenc.push(r);
    }
  });

  summ    = {totFat,totRec,totVenc,totCanc,nBx,nVenc,nCanc,nTot:filtered.length};
  venc30  = allVenc.filter(r=>r.dias>=30);
  venc60  = allVenc.filter(r=>r.dias>=60);
  venc120 = allVenc.filter(r=>r.dias>=120);

  $('#b30').text(venc30.length).addClass('on');
  $('#b60').text(venc60.length).addClass('on');
  $('#b120').text(venc120.length).addClass('on');

  // reset pages
  detState[30].page = 1;
  detState[60].page = 1;
  detState[120].page = 1;

  renderOv();
  // re-render only active detail tab
  const activeBand = TAB_TO_BAND[$('.tab.active').data('tab')];
  if (activeBand) renderDet(activeBand);
  if (generalState.open) renderGeneralModal();
}

// ── OVERVIEW ─────────────────────────────────────────
function renderOv() {
  const s = summ;
  const pRec  = s.totFat ? +(s.totRec /s.totFat*100).toFixed(1) : 0;
  const pVenc = s.totFat ? +(s.totVenc/s.totFat*100).toFixed(1) : 0;
  const pCanc = s.totFat ? +(s.totCanc/s.totFat*100).toFixed(1) : 0;

  const sv = arr => arr.reduce((a,r)=>a+r.valor,0);

  // +30 dias: 30–59
  const b30_only = venc30.filter(r=>r.dias<60);
  // +60 dias: 60–119
  const b60_only = venc60.filter(r=>r.dias<120);
  // +120 dias sub-bands
  const b1 = venc120.filter(r=>r.dias>=120&&r.dias<=180);
  const b2 = venc120.filter(r=>r.dias>180&&r.dias<=365);
  const b3 = venc120.filter(r=>r.dias>365);

  const top10 = venc120.slice().sort((a,b)=>b.valor-a.valor).slice(0,10);

  const isFiltered = isDateFilterActive();
  const filterChip = isFiltered
    ? `<span class="dfactive-chip"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>${fmtDate(dfFrom)} — ${fmtDate(dfTo)}</span>`
    : '';

  $('#ov-body').html(`
    <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:16px">
      <p class="stitle" style="margin:0">Resumo Financeiro</p>
      ${filterChip}
    </div>
    <div class="kg">
      <div class="kc">
        <div class="kl"><span class="kd" style="background:var(--accent)"></span>Total Faturado</div>
        <div class="kv">${R(s.totFat)}</div>
        <div class="ks">${s.nTot.toLocaleString('pt-BR')} títulos no período</div>
        <button class="card-link" type="button" onclick="openGeneralModal('total')">Ver tabela geral →</button>
      </div>
      <div class="kc">
        <div class="kl"><span class="kd" style="background:var(--green)"></span>Contas Recebidas</div>
        <div class="kv">${R(s.totRec)}</div>
        <span class="kp" style="background:var(--green-s);color:var(--green)">${pRec}% do faturado</span>
        <button class="card-link" type="button" onclick="openGeneralModal('recebidas')">Ver tabela geral →</button>
      </div>
      <div class="kc">
        <div class="kl"><span class="kd" style="background:var(--red)"></span>Em Aberto / Vencido</div>
        <div class="kv">${R(s.totVenc)}</div>
        <span class="kp" style="background:var(--red-s);color:var(--red)">${pVenc}% do faturado</span>
        <button class="card-link" type="button" onclick="openGeneralModal('vencidas')">Ver tabela geral →</button>
      </div>
      <div class="kc">
        <div class="kl"><span class="kd" style="background:var(--text3)"></span>Cancelados</div>
        <div class="kv">${R(s.totCanc)}</div>
        <span class="kp" style="background:var(--surface2);color:var(--text2)">${pCanc}% do faturado</span>
        <button class="card-link" type="button" onclick="openGeneralModal('canceladas')">Ver tabela geral →</button>
      </div>
    </div>

    <div class="g2">
      <div class="panel">
        <div class="ph">Composição dos Recebíveis</div>
        <div class="pb">
          <div class="dw">
            <svg id="donut" width="116" height="116" viewBox="0 0 116 116" style="flex-shrink:0"></svg>
            <div class="dl">
              <div class="li"><span class="ld" style="background:var(--green)"></span><span class="ln">Recebido</span><span class="lv">${R(s.totRec)}</span><span class="lp">${pRec}%</span></div>
              <div class="li"><span class="ld" style="background:var(--red)"></span><span class="ln">Inadimplente</span><span class="lv">${R(s.totVenc)}</span><span class="lp">${pVenc}%</span></div>
              <div class="li"><span class="ld" style="background:var(--text3)"></span><span class="ln">Cancelado</span><span class="lv">${R(s.totCanc)}</span><span class="lp">${pCanc}%</span></div>
            </div>
          </div>
        </div>
      </div>
      <div class="panel">
        <div class="ph">Situação dos Títulos</div>
        <div class="pb">
          <div class="br"><span class="bl">Baixados</span><div class="bt"><div class="bf" style="width:${(s.nBx/s.nTot*100).toFixed(1)}%;background:var(--green)"></div></div><span class="bv">${s.nBx.toLocaleString('pt-BR')} títulos</span></div>
          <div class="br"><span class="bl">Vencidos</span><div class="bt"><div class="bf" style="width:${(s.nVenc/s.nTot*100).toFixed(1)}%;background:var(--red)"></div></div><span class="bv">${s.nVenc.toLocaleString('pt-BR')} títulos</span></div>
          <div class="br"><span class="bl">Cancelados</span><div class="bt"><div class="bf" style="width:${(s.nCanc/s.nTot*100).toFixed(1)}%;background:var(--text3)"></div></div><span class="bv">${s.nCanc.toLocaleString('pt-BR')} títulos</span></div>
          <div style="margin-top:18px;padding-top:14px;border-top:1px solid var(--border)">
            <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text2);margin-bottom:7px"><span>Taxa de inadimplência</span><strong style="color:var(--red)">${pVenc}%</strong></div>
            <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text2)"><span>Taxa de recebimento</span><strong style="color:var(--green)">${pRec}%</strong></div>
          </div>
        </div>
      </div>
    </div>

    <p class="stitle">Inadimplência por Faixa de Atraso</p>
    <div class="bandg" style="grid-template-columns:repeat(3,1fr)">

      <div class="bandc" onclick="openDetTab('d30')">
        <div class="bandtop">
          <span class="bandtag" style="background:var(--accent-s);color:var(--accent)">+30 dias</span>
          <span class="bandarr">→</span>
        </div>
        <div class="bandcnt">${venc30.length} título${venc30.length!==1?'s':''} em atraso</div>
        <div class="bandval" style="color:var(--accent)">${R(sv(venc30))}</div>
        <div class="bandpct" style="margin-top:8px;border-top:1px solid var(--border);padding-top:8px">
          <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text2)"><span>30–59 dias</span><strong style="color:var(--accent)">${b30_only.length} · ${R(sv(b30_only))}</strong></div>
        </div>
        <div class="bandpct">${P(sv(venc30),s.totVenc)} do total em aberto</div>
      </div>

      <div class="bandc" onclick="openDetTab('d60')">
        <div class="bandtop">
          <span class="bandtag" style="background:var(--orange-s);color:var(--orange)">+60 dias</span>
          <span class="bandarr">→</span>
        </div>
        <div class="bandcnt">${venc60.length} título${venc60.length!==1?'s':''} em atraso</div>
        <div class="bandval" style="color:var(--orange)">${R(sv(venc60))}</div>
        <div class="bandpct" style="margin-top:8px;border-top:1px solid var(--border);padding-top:8px">
          <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text2)"><span>60–119 dias</span><strong style="color:var(--orange)">${b60_only.length} · ${R(sv(b60_only))}</strong></div>
        </div>
        <div class="bandpct">${P(sv(venc60),s.totVenc)} do total em aberto</div>
      </div>

      <div class="bandc" onclick="openDetTab('d120')">
        <div class="bandtop">
          <span class="bandtag" style="background:var(--red-s);color:var(--red)">+120 dias</span>
          <span class="bandarr">→</span>
        </div>
        <div class="bandcnt">${venc120.length} título${venc120.length!==1?'s':''} em atraso</div>
        <div class="bandval" style="color:var(--red)">${R(sv(venc120))}</div>
        <div class="bandpct" style="margin-top:8px;border-top:1px solid var(--border);padding-top:8px">
          <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text2);margin-bottom:3px"><span>120–180d</span><strong style="color:var(--yellow)">${b1.length} · ${R(sv(b1))}</strong></div>
          <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text2);margin-bottom:3px"><span>180–365d</span><strong style="color:var(--orange)">${b2.length} · ${R(sv(b2))}</strong></div>
          <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text2)"><span>+365d</span><strong style="color:var(--red)">${b3.length} · ${R(sv(b3))}</strong></div>
        </div>
        <div class="bandpct">${P(sv(venc120),s.totVenc)} do total em aberto</div>
      </div>

    </div>

    <p class="stitle" style="margin-top:28px">Top 10 Maiores Devedores (+120 dias) <span onclick="openDetTab('d120')" style="font-size:11px;color:var(--accent);cursor:pointer;font-weight:400;text-transform:none;letter-spacing:0;margin-left:6px">Ver todos →</span></p>
    <div class="panel">
      <div class="ow">
        <table class="dt">
          <thead><tr>
            <th>Cliente</th><th>CNPJ/CPF</th><th>Histórico</th>
            <th>Vencimento</th><th style="text-align:right">Valor</th><th style="text-align:center">Atraso</th>
          </tr></thead>
          <tbody>
          ${top10.length===0
            ? `<tr><td colspan="6" style="text-align:center;padding:28px;color:var(--text3)">Nenhum inadimplente no período selecionado</td></tr>`
            : top10.map(r=>{const b=bandOf(r.dias);return`<tr>
            <td><strong>${r.nome}</strong></td>
            <td style="color:var(--text2);font-size:12px">${r.cnpj}</td>
            <td style="color:var(--text2);font-size:12px;max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${r.historico}">${r.historico||'—'}</td>
            <td style="color:var(--text2)">${r.vencimento}</td>
            <td style="text-align:right;font-weight:600">${R(r.valor)}</td>
            <td style="text-align:center"><span class="badge" style="background:${b.bg};color:${b.c}">${r.dias}d</span></td>
          </tr>`;}).join('')
          }
          </tbody>
        </table>
      </div>
    </div>
  `);
  drawDonut(s);
}

function drawDonut(s) {
  const tot = s.totRec+s.totVenc+s.totCanc;
  const vs  = [s.totRec,s.totVenc,s.totCanc];
  const cs  = ['var(--green)','var(--red)','var(--text3)'];
  const cx=58,cy=58,r=42,sw=15;
  let st=-Math.PI/2,paths='';

  if (!tot) {
    $('#donut').html(`
      <text x="58" y="54" text-anchor="middle" font-size="15" font-weight="700" fill="var(--text)">0%</text>
      <text x="58" y="68" text-anchor="middle" font-size="9" fill="var(--text2)">recebido</text>`);
    return;
  }

  vs.forEach((v,i)=>{
    const a=(v/tot)*Math.PI*2;
    const x1=cx+r*Math.cos(st),y1=cy+r*Math.sin(st);
    const x2=cx+r*Math.cos(st+a),y2=cy+r*Math.sin(st+a);
    paths+=`<path d="M${x1},${y1} A${r},${r} 0 ${a>Math.PI?1:0},1 ${x2},${y2}" fill="none" stroke="${cs[i]}" stroke-width="${sw}"/>`;
    st+=a;
  });
  const pR=tot?(s.totRec/tot*100).toFixed(0):0;
  $('#donut').html(`${paths}
    <text x="58" y="54" text-anchor="middle" font-size="15" font-weight="700" fill="var(--text)">${pR}%</text>
    <text x="58" y="68" text-anchor="middle" font-size="9" fill="var(--text2)">recebido</text>`);
}

// ── GENERAL TABLE MODAL ───────────────────────────────
function getRowsInCurrentPeriod() {
  return allRows.filter(rowInDateRange);
}

function rowMatchesGeneralStatus(row, statusKey) {
  if (statusKey==='all') return true;
  if (statusKey==='baixado') return /baixado/i.test(row.stat||'');
  if (statusKey==='vencido') return /vencido/i.test(row.stat||'');
  if (statusKey==='cancelado') return /cancel/i.test(row.stat||'');
  return true;
}

function getGeneralRowsByCard(card) {
  const cfg = GENERAL_CARD_CONFIG[card] || GENERAL_CARD_CONFIG.total;
  return getRowsInCurrentPeriod().filter(cfg.baseFilter);
}

function getGeneralRowValue(row) {
  return (GENERAL_CARD_CONFIG[generalState.card] || GENERAL_CARD_CONFIG.total).valueFn(row);
}

function getGeneralSortValue(row, column) {
  if (column==='valor') return getGeneralRowValue(row);
  if (column==='situacao') return row.situacao || row.stat || '';
  return row[column] ?? '';
}

function getGeneralFilteredRows() {
  let data = getGeneralRowsByCard(generalState.card);
  data = data.filter(r => rowMatchesGeneralStatus(r, generalState.statusFilter));

  if (generalState.search) {
    data = data.filter(r => rowMatchesSearch(r, generalState.search));
  }

  return data.slice().sort((a,b)=>{
    const av = getGeneralSortValue(a, generalState.sort.c);
    const bv = getGeneralSortValue(b, generalState.sort.c);
    return typeof av==='string'
      ? generalState.sort.d * av.localeCompare(bv)
      : generalState.sort.d * (av - bv);
  });
}

function generalBandColor(dias) {
  if (dias>=120 && dias<=180) return {bg:'var(--yellow-s)', c:'var(--yellow)'};
  if (dias>180 && dias<=365) return {bg:'var(--orange-s)', c:'var(--orange)'};
  if (dias>365) return {bg:'var(--red-s)', c:'var(--red)'};
  if (dias>=60) return {bg:'var(--orange-s)', c:'var(--orange)'};
  if (dias>=30) return {bg:'var(--accent-s)', c:'var(--accent)'};
  return {bg:'var(--surface2)', c:'var(--text2)'};
}

function generalSortIcon(column) {
  if (generalState.sort.c!==column) return '↕';
  return generalState.sort.d===1 ? '↑' : '↓';
}

function generalSortClass(column) {
  return generalState.sort.c===column ? 's' : '';
}

function generalPageBtns(cur,tot) {
  const max=7; let pages=[];
  if (tot<=max) { for(let i=1;i<=tot;i++) pages.push(i); }
  else {
    let s=Math.max(1,cur-3), e=Math.min(tot,s+max-1);
    s=Math.max(1,e-max+1);
    for(let i=s;i<=e;i++) pages.push(i);
  }
  return pages.map(p=>`<button class="pb2 ${p===cur?'on':''}" onclick="goGeneralPage(${p})">${p}</button>`).join('');
}

function renderGeneralModal() {
  if (!generalState.open) return;

  const cfg = GENERAL_CARD_CONFIG[generalState.card] || GENERAL_CARD_CONFIG.total;
  const baseRows = getGeneralRowsByCard(generalState.card);
  const data = getGeneralFilteredRows();
  const totPg = Math.max(1, Math.ceil(data.length/PG));
  if (generalState.page>totPg) generalState.page = totPg;

  const paged = data.slice((generalState.page-1)*PG, generalState.page*PG);
  const baseTotal = baseRows.reduce((a,r)=>a+cfg.valueFn(r),0);
  const filtTotal = data.reduce((a,r)=>a+cfg.valueFn(r),0);
  const rangeLabel = `${fmtDate(dfFrom||dateMin)} — ${fmtDate(dfTo||dateMax)}`;

  $('#general-modal-body').html(`
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--r);padding:18px 20px;margin-bottom:20px;display:flex;align-items:flex-start;gap:16px">
      <div style="width:42px;height:42px;background:${cfg.colorSoft};border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0">📊</div>
      <div>
        <div style="font-size:17px;font-weight:700;margin-bottom:3px">Tabela Geral — ${cfg.label}</div>
        <div style="font-size:13px;color:var(--text2);display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          ${baseRows.length.toLocaleString('pt-BR')} registro${baseRows.length!==1?'s':''} · Total: <strong style="color:${cfg.color}">${R(baseTotal)}</strong>
          <span class="dfactive-chip">${rangeLabel}</span>
        </div>
      </div>
    </div>

    <div class="panel">
      <div class="ph">Lista Geral <span class="phs">${data.length.toLocaleString('pt-BR')} resultado${data.length!==1?'s':''} · ${R(filtTotal)}</span></div>
      <div class="pb" style="padding-bottom:0">
        <div class="tc-wrap">
          <input class="si" id="gm-search" placeholder="Buscar por nome, CNPJ ou histórico…" value="${generalState.search}">
          <div class="fg">
            ${Object.entries(GENERAL_CARD_CONFIG).map(([key,card])=>`<button class="fb ${generalState.card===key?'on':''}" onclick="setGeneralCard('${key}')">${card.label}</button>`).join('')}
          </div>
        </div>

      </div>

      <div class="ow">
        <table class="dt">
          <thead><tr>
            <th class="${generalSortClass('nome')}" onclick="sortGeneral('nome')">Cliente <span>${generalSortIcon('nome')}</span></th>
            <th>CNPJ/CPF</th>
            <th>Histórico</th>
            <th class="${generalSortClass('vencimento')}" onclick="sortGeneral('vencimento')">Vencimento <span>${generalSortIcon('vencimento')}</span></th>
            <th class="${generalSortClass('valor')}" onclick="sortGeneral('valor')" style="text-align:right">${cfg.valueLabel} <span>${generalSortIcon('valor')}</span></th>
            <th class="${generalSortClass('dias')}" onclick="sortGeneral('dias')" style="text-align:center">Dias <span>${generalSortIcon('dias')}</span></th>
            <th class="${generalSortClass('situacao')}" onclick="sortGeneral('situacao')">Situação <span>${generalSortIcon('situacao')}</span></th>
          </tr></thead>
          <tbody>
          ${paged.length===0
            ? `<tr><td colspan="7" style="text-align:center;padding:32px;color:var(--text3)">Nenhum resultado encontrado</td></tr>`
            : paged.map(r=>{const b=generalBandColor(r.dias||0);return`<tr>
              <td><strong>${r.nome||'—'}</strong></td>
              <td style="color:var(--text2);font-size:12px">${r.cnpj||'—'}</td>
              <td style="color:var(--text2);font-size:12px;max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${r.historico||''}">${r.historico||'—'}</td>
              <td style="color:var(--text2)">${r.vencimento||'—'}</td>
              <td style="text-align:right;font-weight:600">${R(getGeneralRowValue(r))}</td>
              <td style="text-align:center"><span class="badge" style="background:${b.bg};color:${b.c}">${r.dias||0}d</span></td>
              <td style="font-size:12px;color:var(--text2)">${r.situacao||r.stat||'—'}</td>
            </tr>`;}).join('')
          }
          </tbody>
        </table>
      </div>

      <div class="pb" style="padding-top:10px">
        <div class="tf">
          <span>Mostrando ${data.length?Math.min((generalState.page-1)*PG+1,data.length):0}–${Math.min(generalState.page*PG,data.length)} de ${data.length.toLocaleString('pt-BR')}</span>
          <div class="pg">
            <button class="pb2" onclick="goGeneralPage(${generalState.page-1})" ${generalState.page===1?'disabled':''}>‹</button>
            ${generalPageBtns(generalState.page,totPg)}
            <button class="pb2" onclick="goGeneralPage(${generalState.page+1})" ${generalState.page>=totPg?'disabled':''}>›</button>
          </div>
        </div>
      </div>
    </div>
  `);

  $('#gm-search').on('input',function(){
    const cursorPos = this.selectionStart ?? $(this).val().length;
    generalState.search = $(this).val();
    generalState.page = 1;
    renderGeneralModal();
    requestAnimationFrame(()=>{
      const input = $('#gm-search').get(0);
      if (!input) return;
      input.focus();
      const pos = Math.min(cursorPos, input.value.length);
      if (typeof input.setSelectionRange==='function') input.setSelectionRange(pos,pos);
    });
  });
}

function openGeneralModal(card='total') {
  if (!allRows.length) {
    showToast('⚠️ Importe um CSV antes de abrir a tabela geral');
    return;
  }

  generalState.open = true;
  generalState.card = GENERAL_CARD_CONFIG[card] ? card : 'total';
  generalState.statusFilter = 'all';
  generalState.search = '';
  generalState.sort = {c:'valor', d:-1};
  generalState.page = 1;

  $('#general-modal').addClass('on');
  $('body').css('overflow','hidden');
  renderGeneralModal();
}

function closeGeneralModal() {
  generalState.open = false;
  $('#general-modal').removeClass('on');
  $('body').css('overflow','');
}

function setGeneralCard(card) {
  if (!GENERAL_CARD_CONFIG[card]) return;
  generalState.card = card;
  generalState.page = 1;
  generalState.sort = {c:'valor', d:-1};
  renderGeneralModal();
}

function setGeneralStatus(statusKey) {
  generalState.statusFilter = statusKey;
  generalState.page = 1;
  renderGeneralModal();
}

function sortGeneral(column) {
  if (generalState.sort.c===column) generalState.sort.d*=-1;
  else {
    generalState.sort.c = column;
    generalState.sort.d = (column==='dias'||column==='valor') ? -1 : 1;
  }
  generalState.page = 1;
  renderGeneralModal();
}

function goGeneralPage(page) {
  const totalPages = Math.max(1, Math.ceil(getGeneralFilteredRows().length/PG));
  if (page<1 || page>totalPages) return;
  generalState.page = page;
  renderGeneralModal();
}

// ── DETAIL ────────────────────────────────────────────
// band: 30 | 60 | 120
function getVencByBand(band) {
  if (band===30) return venc30;
  if (band===60) return venc60;
  return venc120;
}

function bandColorFor(dias, band) {
  if (band===30) {
    if (dias<60)  return {bg:'var(--accent-s)',  c:'var(--accent)'};
    if (dias<120) return {bg:'var(--orange-s)', c:'var(--orange)'};
    return {bg:'var(--red-s)', c:'var(--red)'};
  }
  if (band===60) {
    if (dias<120) return {bg:'var(--orange-s)', c:'var(--orange)'};
    return {bg:'var(--red-s)', c:'var(--red)'};
  }
  // 120
  if (dias<=180) return {bg:'var(--yellow-s)', c:'var(--yellow)'};
  if (dias<=365) return {bg:'var(--orange-s)', c:'var(--orange)'};
  return {bg:'var(--red-s)', c:'var(--red)'};
}

function applyBandFilter(rows, band, filterKey) {
  if (filterKey==='all') return rows;

  if (band===30) {
    if (filterKey==='30_59') return rows.filter(r=>r.dias>=30&&r.dias<60);
    if (filterKey==='60_119') return rows.filter(r=>r.dias>=60&&r.dias<120);
    if (filterKey==='120p') return rows.filter(r=>r.dias>=120);
    return rows;
  }

  if (band===60) {
    if (filterKey==='60_119') return rows.filter(r=>r.dias>=60&&r.dias<120);
    if (filterKey==='120p') return rows.filter(r=>r.dias>=120);
    return rows;
  }

  if (filterKey==='b1') return rows.filter(r=>r.dias>=120&&r.dias<=180);
  if (filterKey==='b2') return rows.filter(r=>r.dias>180&&r.dias<=365);
  if (filterKey==='b3') return rows.filter(r=>r.dias>365);
  return rows;
}

function getFilt(band) {
  const st = detState[band];
  let data = applyBandFilter(getVencByBand(band), band, st.filt);

  if (st.search) {
    data = data.filter(r => rowMatchesSearch(r, st.search));
  }

  return data.slice().sort((a,b)=>{
    const av=a[st.sort.c], bv=b[st.sort.c];
    return typeof av==='string'
      ? st.sort.d * av.localeCompare(bv)
      : st.sort.d * (av - bv);
  });
}

function renderDet(band) {
  if (!summ) return;
  const st    = detState[band];
  const base  = getVencByBand(band);
  const data  = getFilt(band);
  const totPg = Math.max(1,Math.ceil(data.length/PG));
  if (st.page>totPg) st.page=totPg;
  const paged = data.slice((st.page-1)*PG, st.page*PG);
  const totV  = base.reduce((a,r)=>a+r.valor,0);
  const filtV = data.reduce((a,r)=>a+r.valor,0);

  const bodyId = `det-body-${band}`;
  const si = c=>st.sort.c===c?(st.sort.d===1?'↑':'↓'):'↕';
  const sc = c=>st.sort.c===c?'s':'';

  const isFiltered = isDateFilterActive();
  const filterNote = isFiltered
    ? ` · <span class="dfactive-chip" style="font-size:11px"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>${fmtDate(dfFrom)} — ${fmtDate(dfTo)}</span>`
    : '';

  // Band-specific config
  const cfg = {
    30:  { icon:'🕐', color:'var(--accent)',  colorS:'var(--accent-s)',  label:'+30 dias em atraso',
           filters:[
             {k:'all',    lbl:'Todos'},
             {k:'30_59',  lbl:'30–59d'},
             {k:'60_119', lbl:'60–119d'},
             {k:'120p',   lbl:'+120d'},
           ]},
    60:  { icon:'⚠️', color:'var(--orange)', colorS:'var(--orange-s)', label:'+60 dias em atraso',
           filters:[
             {k:'all',    lbl:'Todos'},
             {k:'60_119', lbl:'60–119d'},
             {k:'120p',   lbl:'+120d'},
           ]},
    120: { icon:'🚨', color:'var(--red)',    colorS:'var(--red-s)',    label:'+120 dias em atraso',
           filters:[
             {k:'all', lbl:'Todos'},
             {k:'b1',  lbl:'120–180d'},
             {k:'b2',  lbl:'180–365d'},
             {k:'b3',  lbl:'+365d'},
           ]},
  }[band];

  $(`#${bodyId}`).html(`
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--r);padding:18px 20px;margin-bottom:20px;display:flex;align-items:flex-start;gap:16px">
      <div style="width:42px;height:42px;background:${cfg.colorS};border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0">${cfg.icon}</div>
      <div>
        <div style="font-size:17px;font-weight:700;margin-bottom:3px">Inadimplentes — ${cfg.label}</div>
        <div style="font-size:13px;color:var(--text2);display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          ${base.length} registro${base.length!==1?'s':''} · Total: <strong style="color:${cfg.color}">${R(totV)}</strong>${filterNote}
        </div>
      </div>
    </div>

    <div class="panel">
      <div class="ph">Lista de Inadimplentes <span class="phs">${data.length} resultado${data.length!==1?'s':''} · ${R(filtV)}</span></div>
      <div class="pb" style="padding-bottom:0">
        <div class="tc-wrap">
          <input class="si" id="ds-${band}" placeholder="Buscar por nome, CNPJ ou histórico…" value="${st.search}">
          <div class="fg">
            ${cfg.filters.map(f=>`<button class="fb ${st.filt===f.k?'on':''}" onclick="setDetF(${band},'${f.k}')">${f.lbl}</button>`).join('')}
          </div>
        </div>
      </div>
      <div class="ow">
        <table class="dt">
          <thead><tr>
            <th class="${sc('nome')}" onclick="sDetSort(${band},'nome')">Cliente <span>${si('nome')}</span></th>
            <th>CNPJ/CPF</th>
            <th>Histórico</th>
            <th class="${sc('vencimento')}" onclick="sDetSort(${band},'vencimento')">Vencimento <span>${si('vencimento')}</span></th>
            <th class="${sc('valor')}" onclick="sDetSort(${band},'valor')" style="text-align:right">Valor <span>${si('valor')}</span></th>
            <th class="${sc('dias')}" onclick="sDetSort(${band},'dias')" style="text-align:center">Dias <span>${si('dias')}</span></th>
            <th>Situação</th>
          </tr></thead>
          <tbody>
          ${paged.length===0
            ?`<tr><td colspan="7" style="text-align:center;padding:32px;color:var(--text3)">Nenhum resultado encontrado</td></tr>`
            :paged.map(r=>{const b=bandColorFor(r.dias,band);return`<tr>
              <td><strong>${r.nome}</strong></td>
              <td style="color:var(--text2);font-size:12px">${r.cnpj}</td>
              <td style="color:var(--text2);font-size:12px;max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${r.historico}">${r.historico||'—'}</td>
              <td style="color:var(--text2)">${r.vencimento}</td>
              <td style="text-align:right;font-weight:600">${R(r.valor)}</td>
              <td style="text-align:center"><span class="badge" style="background:${b.bg};color:${b.c}">${r.dias}d</span></td>
              <td style="font-size:12px;color:var(--text2)">${r.situacao||'—'}</td>
            </tr>`;}).join('')
          }
          </tbody>
        </table>
      </div>
      <div class="pb" style="padding-top:10px">
        <div class="tf">
          <span>Mostrando ${data.length?Math.min((st.page-1)*PG+1,data.length):0}–${Math.min(st.page*PG,data.length)} de ${data.length}</span>
          <div class="pg">
            <button class="pb2" onclick="goPg(${band},${st.page-1})" ${st.page===1?'disabled':''}>‹</button>
            ${pgBtns(st.page,totPg,band)}
            <button class="pb2" onclick="goPg(${band},${st.page+1})" ${st.page>=totPg?'disabled':''}>›</button>
          </div>
        </div>
      </div>
    </div>
  `);

  $(`#ds-${band}`).on('input',function(){
    const cursorPos = this.selectionStart ?? $(this).val().length;
    detState[band].search = $(this).val();
    detState[band].page = 1;
    renderDet(band);
    requestAnimationFrame(()=>{
      const input = $(`#ds-${band}`).get(0);
      if (!input) return;
      input.focus();
      const pos = Math.min(cursorPos, input.value.length);
      if (typeof input.setSelectionRange==='function') input.setSelectionRange(pos,pos);
    });
  });
}

function pgBtns(cur,tot,band) {
  const max=7; let pages=[];
  if (tot<=max) { for(let i=1;i<=tot;i++) pages.push(i); }
  else {
    let s=Math.max(1,cur-3), e=Math.min(tot,s+max-1);
    s=Math.max(1,e-max+1);
    for(let i=s;i<=e;i++) pages.push(i);
  }
  return pages.map(p=>`<button class="pb2 ${p===cur?'on':''}" onclick="goPg(${band},${p})">${p}</button>`).join('');
}

function setDetF(band,f) {
  detState[band].filt = f;
  detState[band].page = 1;
  renderDet(band);
}

function sDetSort(band,c) {
  const s = detState[band].sort;
  if (s.c===c) {
    s.d *= -1;
  } else {
    s.c = c;
    s.d = c==='dias' ? -1 : 1;
  }
  detState[band].page = 1;
  renderDet(band);
}

function goPg(band,p) {
  const totalPages = Math.max(1, Math.ceil(getFilt(band).length/PG));
  if (p<1 || p>totalPages) return;
  detState[band].page = p;
  renderDet(band);
}

function openDetTab(tabId) {
  const band = TAB_TO_BAND[tabId];
  setActiveTab(tabId);
  renderDet(band);
}

// ── EVENTS ────────────────────────────────────────────
$(function(){
  $(document).on('click','.tab',function(){
    const t = $(this).data('tab');
    setActiveTab(t);
    const band = TAB_TO_BAND[t];
    if (band) renderDet(band);
  });

  $('#themeBtn').click(function(){
    const l=$('body').hasClass('light');
    $('body').toggleClass('light');
    $('#themeIco').text(l?'☀️':'🌙');
    $('#themeLbl').text(l?'Modo Claro':'Modo Escuro');
  });

  $('#fi').change(function(){
    const f=this.files[0];
    handleCsvFile(f, '⚠️ Selecione um arquivo .csv');
    $(this).val('');
  });

  $('body').on('dragover','*',function(e){
    e.preventDefault(); $('#drop-zone').addClass('drag');
  }).on('dragleave',function(){
    $('#drop-zone').removeClass('drag');
  }).on('drop',function(e){
    e.preventDefault(); $('#drop-zone').removeClass('drag');
    const f=e.originalEvent.dataTransfer.files[0];
    handleCsvFile(f, '⚠️ Solte um arquivo .csv');
  });

  $('#general-modal-close').on('click', closeGeneralModal);
  $('#general-modal').on('click', function(e){
    if (e.target===this) closeGeneralModal();
  });
  $(document).on('keydown', function(e){
    if (e.key==='Escape' && generalState.open) closeGeneralModal();
  });
});
