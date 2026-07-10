# -*- coding: utf-8 -*-
"""Find Rappi / Moustache Beams in Omie client registry across all connections (read-only)."""
import json, time, urllib.request, urllib.error
from pathlib import Path
ENV=Path(__file__).resolve().parent.parent/".env"
URL="https://app.omie.com.br/api/v1/geral/clientes/"

def conns():
    out,label,p=[],None,{}
    for line in ENV.read_text(encoding="utf-8").splitlines():
        s=line.strip()
        if s.startswith("##"): label=s.lstrip("#").strip(); p={}; continue
        if s.startswith("#") or "=" not in s: continue
        k,v=(x.strip() for x in s.split("=",1))
        if k.startswith("OMIE_APP_KEY_"): p["ak"]=v
        elif k.startswith("OMIE_APP_SECRET_"): p["as"]=v
        if "ak" in p and "as" in p: out.append({"label":label,**p}); p={}
    return out

def call(ak,as_,param,retries=6):
    body=json.dumps({"app_key":ak,"app_secret":as_,"call":"ListarClientes","param":[param]}).encode()
    for a in range(retries):
        time.sleep(2.0)
        try:
            req=urllib.request.Request(URL,data=body,headers={"Content-Type":"application/json"})
            with urllib.request.urlopen(req,timeout=90) as r: return json.loads(r.read().decode())
        except urllib.error.HTTPError as e:
            txt=e.read().decode("utf-8","replace"); low=txt.lower()
            if any(m in low for m in ("requisi","consumo","redundante","aguarde")): time.sleep(12); continue
            return {"_err":txt}
        except (ConnectionResetError,OSError): time.sleep(12); continue
    return {"_err":"retries"}

terms=["RAPPI","MOUSTACHE","BIGODE"]
for c in conns():
    for t in terms:
        r=call(c["ak"],c["as"],{"pagina":1,"registros_por_pagina":50,"clientesFiltro":{"razao_social":f"%{t}%"}})
        cli=r.get("clientes_cadastro",[]) if isinstance(r,dict) else []
        if r.get("_err"): print(f"[{c['label']}] {t}: ERR {r['_err'][:80]}"); continue
        if cli:
            for x in cli:
                print(f"[{c['label']}] {t}: cod={x.get('codigo_cliente_omie')} cnpj={x.get('cnpj_cpf')} razao={x.get('razao_social')} fant={x.get('nome_fantasia')}")
        else:
            print(f"[{c['label']}] {t}: 0")
