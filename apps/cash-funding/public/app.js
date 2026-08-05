const fmtBRL = (n) => Number(n).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString("pt-BR", { timeZone: "UTC" }) : "—");
const toInputDate = (d) => (d ? new Date(d).toISOString().slice(0, 10) : "");

async function api(path, opts) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (res.status === 401) {
    location.href = "/login.html";
    throw new Error("not authenticated");
  }
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return res.json();
}

let fundersCache = [];
let lastSuggestion = null;

async function loadMe() {
  const { user } = await api("/api/me");
  if (!user) {
    location.href = "/login.html";
    return;
  }
  document.getElementById("me").textContent = user.name || user.email;
}

async function loadFunders() {
  fundersCache = await api("/api/funders");
  const el = document.getElementById("funders");
  el.innerHTML = "";
  const grid = document.createElement("div");
  grid.className = "grid-2";
  for (const f of fundersCache) {
    const card = document.createElement("div");
    const fields = [
      ["taxaAmPct", "Taxa a.m. (%)"],
      ["iofDiarioPct", "IOF diário (%)"],
      ["iofFixoPct", "IOF fixo (%)"],
      ["tarifaOperacao", "Tarifa/operação (R$)"],
      ["tarifaTitulo", "Tarifa/título (R$)"],
      ["tenorMaxDias", "Tenor máx (dias)"],
      ["tetoLinha", "Teto (R$)"],
      ["perSacadoCap", "Cap por sacado (R$)"],
    ];
    card.innerHTML = `
      <h3 style="margin:0 0 8px;font-size:14px;">
        ${f.name} ${f.costsConfirmed ? "" : '<span class="badge badge-warn">custos não confirmados</span>'}
      </h3>
      <table>${fields
        .map(
          ([key, label]) => `
        <tr><td>${label}</td><td><input type="number" step="any" data-key="${key}" value="${f[key] ?? ""}" /></td></tr>`,
        )
        .join("")}
      </table>
      <button class="btn btn-sm" style="margin-top:8px" data-save="${f.id}">Salvar</button>
      ${f.notes ? `<p class="muted" style="font-size:11.5px;margin-top:8px">${f.notes}</p>` : ""}
    `;
    grid.appendChild(card);
  }
  el.appendChild(grid);

  el.querySelectorAll("[data-save]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const card = btn.closest("div");
      const inputs = card.querySelectorAll("input[data-key]");
      const data = {};
      inputs.forEach((i) => {
        data[i.dataset.key] = i.value === "" ? null : Number(i.value);
      });
      await api(`/api/funders/${btn.dataset.save}`, { method: "PUT", body: JSON.stringify(data) });
      await Promise.all([loadFunders(), loadUtilization()]);
    });
  });
}

async function loadUtilization() {
  const util = await api("/api/utilization");
  const el = document.getElementById("utilization");
  el.innerHTML = util
    .map((u) => {
      const funder = fundersCache.find((f) => f.id === u.funderId);
      const pct = Math.min(100, (u.usado / u.teto) * 100);
      return `
      <div style="margin-bottom:10px">
        <div style="display:flex;justify-content:space-between">
          <b>${funder ? funder.name : u.funderId}</b>
          <span class="muted">${fmtBRL(u.usado)} / ${fmtBRL(u.teto)} (disponível ${fmtBRL(u.disponivel)})</span>
        </div>
        <div class="bar"><div class="bar-fill" style="width:${pct}%"></div></div>
      </div>`;
    })
    .join("");
}

async function loadDeliveries() {
  const deliveries = await api("/api/deliveries");
  const body = document.getElementById("deliveries-body");
  body.innerHTML = deliveries
    .map(
      (d) => `
    <tr>
      <td>${d.cliente}</td>
      <td>${d.produto}</td>
      <td class="right">${fmtBRL(d.total)}</td>
      <td>${d.numParcelas}x</td>
      <td>${d.calendar === "corrido" ? "Corrido" : "Terça 3-25"}</td>
      <td>${fmtDate(d.dataEntrega)}</td>
      <td>${d.status}</td>
    </tr>`,
    )
    .join("");
}

function statusBadge(status) {
  const map = { open: "Aberta", planned: "Planejada", operated: "Operada" };
  return `<span class="badge badge-${status}">${map[status] ?? status}</span>`;
}

async function loadInstallments() {
  const installments = await api("/api/installments");
  const body = document.getElementById("installments-body");
  body.innerHTML = installments
    .filter((i) => i.status !== "operated")
    .map((i) => {
      const funderOptions = [`<option value="">—</option>`]
        .concat(fundersCache.map((f) => `<option value="${f.id}" ${i.funderId === f.id ? "selected" : ""}>${f.name}</option>`))
        .join("");
      return `
      <tr data-id="${i.id}">
        <td>${i.delivery.cliente}</td>
        <td>${i.delivery.produto} #${i.numero}</td>
        <td>${i.numero}</td>
        <td>${fmtDate(i.dataVencimento)}</td>
        <td class="right">${fmtBRL(i.valorFace)}</td>
        <td><select data-role="funder">${funderOptions}</select></td>
        <td><input type="date" data-role="discount" value="${toInputDate(i.dataDesconto)}" /></td>
        <td class="right" data-role="net">—</td>
        <td>${statusBadge(i.status)}</td>
      </tr>`;
    })
    .join("");

  body.querySelectorAll("tr").forEach((tr) => {
    const save = async () => {
      const id = tr.dataset.id;
      const funderId = tr.querySelector('[data-role="funder"]').value || null;
      const discount = tr.querySelector('[data-role="discount"]').value;
      const dataDesconto = discount || null;
      const updated = await api(`/api/installments/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ funderId, dataDesconto }),
      });
      tr.querySelector('[data-role="net"]').textContent = updated.cost ? fmtBRL(updated.cost.liquido) : "—";
      const badge = tr.querySelector(".badge, .badge-open, .badge-planned");
      if (badge) badge.outerHTML = statusBadge(updated.status);
      await loadUtilization();
    };
    tr.querySelector('[data-role="funder"]').addEventListener("change", save);
    tr.querySelector('[data-role="discount"]').addEventListener("change", save);
  });
}

async function loadOperations() {
  const ops = await api("/api/operations");
  const body = document.getElementById("operations-body");
  body.innerHTML = ops
    .map(
      (o) => `
    <tr>
      <td>${o.opNumero ?? "—"}</td>
      <td>${o.funder.name}</td>
      <td>${fmtDate(o.dataOperacao)}</td>
      <td class="right">${fmtBRL(o.faceTotal)}</td>
      <td class="right">${fmtBRL(o.custoTotal)}</td>
      <td class="right">${fmtBRL(o.liquido)}</td>
      <td>${fmtDate(o.dataVencimentoFinal)}</td>
    </tr>`,
    )
    .join("");
}

async function suggestAllocation() {
  const discountDate = document.getElementById("alloc-discount-date").value;
  const cutoffDate = document.getElementById("alloc-cutoff-date").value;
  if (!discountDate) {
    alert("Escolha a data de desconto.");
    return;
  }
  const body = { discountDate, cutoffDate: cutoffDate || null };
  const result = await api("/api/allocation/suggest", { method: "POST", body: JSON.stringify(body) });
  lastSuggestion = result;

  const totalsEl = document.getElementById("alloc-totals");
  totalsEl.innerHTML = `
    <div><b>${result.totals.count}</b>parcelas alocadas</div>
    <div><b>${fmtBRL(result.totals.totalFace)}</b>face</div>
    <div><b>${fmtBRL(result.totals.totalNet)}</b>líquido</div>
    <div><b>${fmtBRL(result.totals.totalCost)}</b>custo total</div>
  `;

  const resultsEl = document.getElementById("alloc-results");
  const rows = result.results
    .map((r) => {
      const funder = r.funderId ? fundersCache.find((f) => f.id === r.funderId)?.name : null;
      return `<tr>
        <td>${r.installmentId.slice(0, 8)}</td>
        <td>${funder ?? "—"}</td>
        <td>${r.cost ? r.cost.dias : "—"}</td>
        <td class="right">${r.cost ? fmtBRL(r.cost.liquido) : "—"}</td>
        <td>${r.reason ? `<span class="muted">${r.reason}</span>` : ""}</td>
      </tr>`;
    })
    .join("");
  resultsEl.innerHTML = `<table><thead><tr><th>Parcela</th><th>Funder sugerido</th><th>Dias</th><th class="right">Líquido</th><th>Obs.</th></tr></thead><tbody>${rows}</tbody></table>`;

  document.getElementById("alloc-apply").disabled = result.results.every((r) => !r.funderId);
}

async function applyAllocation() {
  if (!lastSuggestion) return;
  const assignments = lastSuggestion.results
    .filter((r) => r.funderId)
    .map((r) => ({ installmentId: r.installmentId, funderId: r.funderId, discountDate: r.discountDate }));
  await api("/api/allocation/apply", { method: "POST", body: JSON.stringify({ assignments }) });
  lastSuggestion = null;
  document.getElementById("alloc-apply").disabled = true;
  document.getElementById("alloc-results").innerHTML = "";
  document.getElementById("alloc-totals").innerHTML = "";
  await Promise.all([loadInstallments(), loadUtilization()]);
}

async function init() {
  await loadMe();
  await loadFunders();
  await Promise.all([loadUtilization(), loadDeliveries(), loadInstallments(), loadOperations()]);

  document.getElementById("alloc-discount-date").valueAsDate = new Date();
  document.getElementById("alloc-suggest").addEventListener("click", suggestAllocation);
  document.getElementById("alloc-apply").addEventListener("click", applyAllocation);
  document.getElementById("logout").addEventListener("click", async () => {
    await api("/auth/logout", { method: "POST" });
    location.href = "/login.html";
  });
}

init().catch((e) => console.error(e));
