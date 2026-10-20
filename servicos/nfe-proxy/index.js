// nfe-proxy — intermediário entre a função "nfe" do Supabase e a SEFAZ (Google Cloud Run, região São Paulo).
// Por que existe: a SEFAZ só pede o certificado do cliente DEPOIS de abrir a conexão (renegociação TLS), e o servidor
// de funções do Supabase (Deno/rustls) não aceita renegociação. O Node (OpenSSL) aceita.
//
// O que faz: recebe { url, acao, xml, pfx (base64), senha }, faz o POST SOAP 1.2 com o certificado e devolve
// { status, corpo }. Não guarda nada e não grava log do conteúdo. Só aceita endereços *.fazenda.gov.br.
// Acesso: cabeçalho x-chave igual ao segredo PROXY_CHAVE (Secret Manager do Google; a mesma chave fica no Supabase).
const http = require('http'), https = require('https'), crypto = require('crypto');

const CHAVE = process.env.PROXY_CHAVE || '';
const LIMITE = 1024 * 1024;   // 1 MB por pedido (certificado + XML cabem com folga)

function igual(a, b){
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
function responder(res, status, obj){ res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); }

function soap({ url, acao, xml, pfx, senha }){
  return new Promise((ok) => {
    const u = new URL(url);
    const req = https.request({
      method: 'POST', hostname: u.hostname, port: u.port || 443, path: u.pathname + u.search,
      pfx: Buffer.from(pfx, 'base64'), passphrase: senha,
      maxVersion: 'TLSv1.2',          // a renegociação (pedido do certificado) só existe até o TLS 1.2
      timeout: 45000,
      headers: { 'Content-Type': 'application/soap+xml; charset=utf-8' + (acao ? '; action="' + acao + '"' : ''), 'Content-Length': Buffer.byteLength(xml) },
    }, (r) => { const partes = []; r.on('data', p => partes.push(p)); r.on('end', () => ok({ status: r.statusCode, corpo: Buffer.concat(partes).toString('utf8') })); });
    req.on('timeout', () => req.destroy(new Error('tempo esgotado falando com a SEFAZ')));
    req.on('error', (e) => ok({ status: 0, erro: String(e && e.message || e).slice(0, 300) }));
    req.end(xml);
  });
}

http.createServer((req, res) => {
  if(req.method === 'GET' && req.url === '/saude') return responder(res, 200, { ok: true });
  if(req.method !== 'POST' || req.url !== '/soap') return responder(res, 404, { erro: 'não encontrado' });
  if(!CHAVE || !igual(req.headers['x-chave'] || '', CHAVE)) return responder(res, 401, { erro: 'não autorizado' });
  let tam = 0; const partes = [];
  req.on('data', p => { tam += p.length; if(tam > LIMITE){ responder(res, 413, { erro: 'pedido grande demais' }); req.destroy(); } else partes.push(p); });
  req.on('end', async () => {
    if(res.writableEnded) return;
    let b; try { b = JSON.parse(Buffer.concat(partes).toString('utf8')); } catch { return responder(res, 400, { erro: 'JSON inválido' }); }
    let host = ''; try { host = new URL(String(b.url || '')).hostname; } catch {}
    if(!/^https:/.test(String(b.url || '')) || !/(^|\.)fazenda\.gov\.br$/.test(host)) return responder(res, 400, { erro: 'endereço não permitido' });
    if(!b.xml || !b.pfx) return responder(res, 400, { erro: 'faltou xml ou certificado' });
    responder(res, 200, await soap({ url: String(b.url), acao: b.acao ? String(b.acao) : '', xml: String(b.xml), pfx: String(b.pfx), senha: String(b.senha || '') }));
  });
}).listen(Number(process.env.PORT) || 8080);
