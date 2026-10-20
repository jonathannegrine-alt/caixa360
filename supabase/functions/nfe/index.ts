// nfe — notas fiscais recebidas pelos CNPJs do usuário (Distribuição de DF-e da SEFAZ, Ambiente Nacional).
// Só CONSULTA: nada é lançado sozinho em contas, ordens ou estoque.
//
//   tela (JWT)  { acao: 'certificado', loja, pfx (base64), senha }  guarda o A1 cifrado e já faz a 1ª consulta
//               { acao: 'remover', cnpj }                          apaga o certificado (as notas ficam)
//               { acao: 'consultar' }                              consulta agora (respeita a espera da SEFAZ)
//   cron        { cron: true, secret }                             consulta todos os CNPJs (4 vezes por dia)
//
// Certificado: .pfx e senha cifrados com AES-GCM (chave NFE_CERT_KEY, só aqui). A conexão com a SEFAZ usa TLS com o
// certificado do cliente (Deno.createHttpClient, HTTP/1.1: o Ambiente Nacional recusa HTTP/2).
// Regras da SEFAZ (NT 2014.002): pede-se "tudo depois do último NSU", 50 documentos por vez, últimos 90 dias. Quando
// não há mais nada (cStat 137 ou ultNSU = maxNSU) é preciso esperar 1 hora; consultar antes dá 656 (consumo indevido).
// Documentos: resNFe (resumo, sem Ciência), procNFe (nota completa, depois da Ciência), resEvento/procEventoNFe
// (cancelamento 110111 marca a nota como cancelada). Nota completa: XML compactado no Storage (nfe/<usuario>/<chave>.xml.gz).
import forge from 'https://esm.sh/node-forge@1.3.1'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
}
const resp = (body: object, status = 200) => new Response(JSON.stringify(body), { headers: CORS, status })
const URL_DIST = 'https://www1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx'
const UF_AUTOR = '35'           // São Paulo (as duas lojas); o Ambiente Nacional atende qualquer UF
const MAX_CHAMADAS = 20         // por CNPJ e por execução (20 × 50 documentos)
const ESPERA = 61 * 60 * 1000   // 1 hora (e um minuto de folga) depois de "nada novo"

// ---------- cifra ----------
const b64 = (u: Uint8Array) => { let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s) }
const deB64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0))
async function chave() {
  const k = Deno.env.get('NFE_CERT_KEY'); if (!k) throw new Error('chave de cifra ausente no servidor')
  return crypto.subtle.importKey('raw', deB64(k), 'AES-GCM', false, ['encrypt', 'decrypt'])
}
async function cifrar(dados: Uint8Array) {
  const iv = crypto.getRandomValues(new Uint8Array(12)), c = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await chave(), dados))
  const out = new Uint8Array(12 + c.length); out.set(iv); out.set(c, 12); return b64(out)
}
async function decifrar(s: string) {
  const u = deB64(s); return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: u.subarray(0, 12) }, await chave(), u.subarray(12)))
}

// ---------- certificado ----------
function lerPfx(pfx: Uint8Array, senha: string) {
  let bin = ''; for (let i = 0; i < pfx.length; i++) bin += String.fromCharCode(pfx[i])
  const p12 = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(bin), false, senha)
  const chaves = [...(p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] || []), ...(p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] || [])]
  const certs = (p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] || []).map((b: any) => b.cert).filter(Boolean)
  const key = chaves[0]?.key; if (!key || !certs.length) throw new Error('o arquivo não tem certificado e chave')
  // o certificado da empresa é o que casa com a chave; os outros são da cadeia (autoridades)
  const folha = certs.find((c: any) => c.publicKey && c.publicKey.n && c.publicKey.n.equals(key.n)) || certs[0]
  const cn = String(folha.subject.getField('CN')?.value || '')
  const cnpj = (cn.match(/(\d{14})/) || [])[1] || ''
  return {
    cnpj, titular: cn.replace(/:\d{14}$/, '').trim(), validade: folha.validity.notAfter as Date,
    certPem: [folha, ...certs.filter((c: any) => c !== folha)].map((c: any) => forge.pki.certificateToPem(c)).join(''),
    keyPem: forge.pki.privateKeyInfoToPem(forge.pki.wrapRsaPrivateKey(forge.pki.privateKeyToAsn1(key))),
  }
}
function clienteTls(certPem: string, keyPem: string) {
  const D = Deno as any
  try { return D.createHttpClient({ cert: certPem, key: keyPem, http1: true, http2: false }) }
  catch { return D.createHttpClient({ certChain: certPem, privateKey: keyPem, http1: true, http2: false }) }
}

// ---------- XML ----------
const tag = (x: string, t: string) => { const m = x.match(new RegExp('<(?:\\w+:)?' + t + '(?:\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?' + t + '>')); return m ? m[1].trim() : '' }
const todas = (x: string, t: string) => [...x.matchAll(new RegExp('<(?:\\w+:)?' + t + '(?:\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?' + t + '>', 'g'))].map(m => m[1])
const ent = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
const num = (s: string) => { const n = Number(s); return isFinite(n) ? n : null }
async function gunzip(b: string) {
  return await new Response(new Blob([deB64(b)]).stream().pipeThrough(new DecompressionStream('gzip'))).text()
}
async function gzip(s: string) {
  return new Uint8Array(await new Response(new Blob([s]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer())
}
function envelope(cnpj: string, ultNSU: string) {
  const dist = `<distDFeInt xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01"><tpAmb>1</tpAmb><cUFAutor>${UF_AUTOR}</cUFAutor><CNPJ>${cnpj}</CNPJ><distNSU><ultNSU>${ultNSU.padStart(15, '0')}</ultNSU></distNSU></distDFeInt>`
  return `<?xml version="1.0" encoding="utf-8"?><soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap12="http://www.w3.org/2003/05/soap-envelope"><soap12:Body><nfeDistDFeInteresse xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe"><nfeDadosMsg>${dist}</nfeDadosMsg></nfeDistDFeInteresse></soap12:Body></soap12:Envelope>`
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  try {
    const supaUrl = Deno.env.get('SUPABASE_URL')!, supaKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const dbH = { apikey: supaKey, Authorization: `Bearer ${supaKey}`, 'Content-Type': 'application/json' }
    const db = (caminho: string, init: RequestInit = {}) => fetch(`${supaUrl}/rest/v1/${caminho}`, { ...init, headers: { ...dbH, ...(init.headers || {}) } })
    const body = await req.json().catch(() => ({}))

    let uid = ''
    if (body?.cron === true) {
      if (!Deno.env.get('CRON_SECRET') || body.secret !== Deno.env.get('CRON_SECRET')) return resp({ error: 'não autorizado' }, 401)
    } else {
      const u = await fetch(`${supaUrl}/auth/v1/user`, { headers: { apikey: anonKey, Authorization: req.headers.get('Authorization') || '' } })
      if (!u.ok) return resp({ error: 'Sessão inválida — faça login novamente.' }, 401)
      uid = String((await u.json()).id)
    }

    // ----- guardar certificado -----
    if (body?.acao === 'certificado') {
      if (!uid) return resp({ error: 'só pela tela' }, 400)
      const pfx = deB64(String(body.pfx || '')), senha = String(body.senha || '')
      if (!pfx.length) return resp({ error: 'Arquivo vazio.' })
      let c
      try { c = lerPfx(pfx, senha) } catch (e) {
        const m = String((e as Error)?.message || e)
        return resp({ error: /mac|password|invalid/i.test(m) ? 'Senha do certificado incorreta.' : 'Não consegui abrir o certificado: ' + m.slice(0, 120) })
      }
      if (!c.cnpj) return resp({ error: 'Este certificado não é um e-CNPJ (não achei o CNPJ nele).' })
      if (c.validade.getTime() < Date.now()) return resp({ error: 'Este certificado venceu em ' + c.validade.toLocaleDateString('pt-BR') + '.' })
      const reg = { usuario_id: uid, cnpj: c.cnpj, loja: body.loja ? String(body.loja) : null, titular: c.titular, validade: c.validade.toISOString(), pfx: await cifrar(pfx), senha: await cifrar(new TextEncoder().encode(senha)) }
      const g = await db('nfe_certificados?on_conflict=usuario_id,cnpj', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify([reg]) })
      if (!g.ok) return resp({ error: 'Não consegui guardar: ' + (await g.text()).slice(0, 160) })
      await db('nfe_dist?on_conflict=usuario_id,cnpj', { method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' }, body: JSON.stringify([{ usuario_id: uid, cnpj: c.cnpj }]) })
      const r = await consultar(uid, c.cnpj)
      return resp({ ok: true, cnpj: c.cnpj, titular: c.titular, validade: c.validade.toISOString(), consulta: r })
    }
    if (body?.acao === 'remover') {
      if (!uid) return resp({ error: 'só pela tela' }, 400)
      await db(`nfe_certificados?usuario_id=eq.${uid}&cnpj=eq.${String(body.cnpj || '').replace(/\D/g, '')}`, { method: 'DELETE' })
      return resp({ ok: true })
    }

    // ----- consultar -----
    const certs = await db(`nfe_certificados?select=usuario_id,cnpj${uid ? '&usuario_id=eq.' + uid : ''}`).then(r => r.json()).catch(() => [])
    const out: any[] = []
    for (const c of (Array.isArray(certs) ? certs : [])) out.push(await consultar(String(c.usuario_id), String(c.cnpj)))
    return resp({ ok: true, cnpjs: out })

    // consulta um CNPJ até não haver mais nada (ou até o limite da execução)
    async function consultar(usuario: string, cnpj: string) {
      const info: any = { cnpj, chamadas: 0, documentos: 0 }
      try {
        const [cert] = await db(`nfe_certificados?usuario_id=eq.${usuario}&cnpj=eq.${cnpj}&select=*`).then(r => r.json())
        if (!cert) return { ...info, erro: 'sem certificado' }
        if (cert.validade && Date.parse(cert.validade) < Date.now()) return { ...info, erro: 'certificado vencido' }
        let [dist] = await db(`nfe_dist?usuario_id=eq.${usuario}&cnpj=eq.${cnpj}&select=*`).then(r => r.json())
        if (!dist) dist = { ult_nsu: '000000000000000' }
        if (dist.esperar_ate && Date.parse(dist.esperar_ate) > Date.now()) return { ...info, espera: dist.esperar_ate }
        const c = lerPfx(await decifrar(cert.pfx), new TextDecoder().decode(await decifrar(cert.senha)))
        const client = clienteTls(c.certPem, c.keyPem)
        let ult = String(dist.ult_nsu || '0'), max = String(dist.max_nsu || ''), esperar: string | null = null, status = ''
        try {
          while (info.chamadas < MAX_CHAMADAS) {
            info.chamadas++
            const r = await fetch(URL_DIST, { method: 'POST', client, signal: AbortSignal.timeout(40000), body: envelope(cnpj, ult),
              headers: { 'Content-Type': 'application/soap+xml; charset=utf-8; action="http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe/nfeDistDFeInteresse"' } } as any)
            const txt = await r.text()
            if (!r.ok) { status = 'http ' + r.status + ': ' + txt.slice(0, 160); break }
            const ret = tag(txt, 'retDistDFeInt'), cStat = tag(ret, 'cStat'), xMotivo = tag(ret, 'xMotivo')
            status = cStat + ' ' + xMotivo
            if (cStat === '656') { esperar = new Date(Date.now() + ESPERA).toISOString(); break }
            if (cStat !== '137' && cStat !== '138') break
            const nUlt = tag(ret, 'ultNSU'), nMax = tag(ret, 'maxNSU')
            const docs = [...ret.matchAll(/<docZip NSU="(\d+)" schema="([^"]+)">([^<]+)<\/docZip>/g)]
            for (const [, nsu, schema, conteudo] of docs) { await guardarDoc(usuario, cnpj, cert.loja, nsu, schema, await gunzip(conteudo)); info.documentos++ }
            if (nUlt) ult = nUlt
            if (nMax) max = nMax
            if (cStat === '137' || !docs.length || (max && ult >= max)) { esperar = new Date(Date.now() + ESPERA).toISOString(); break }
          }
        } finally { try { client.close() } catch { /* */ } }
        await db(`nfe_dist?usuario_id=eq.${usuario}&cnpj=eq.${cnpj}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({ ult_nsu: ult, max_nsu: max || null, esperar_ate: esperar, consultado_em: new Date().toISOString(), status: status.slice(0, 200) }) })
        info.status = status; info.ult_nsu = ult; info.max_nsu = max
      } catch (e) { info.erro = String((e as Error)?.message || e).slice(0, 200) }
      return info
    }

    async function guardarDoc(usuario: string, cnpj: string, loja: string | null, nsu: string, schema: string, xml: string) {
      const agora = new Date().toISOString()
      const gravar = (linha: Record<string, unknown>) => db('nfe_recebidas?on_conflict=usuario_id,chave', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify([{ usuario_id: usuario, cnpj_dest: cnpj, loja, atualizado_em: agora, ...linha }]) })
      if (/^resNFe/.test(schema)) {
        const chave = tag(xml, 'chNFe'); if (!chave) return
        await gravar({ chave, nsu, emit_cnpj: tag(xml, 'CNPJ') || tag(xml, 'CPF'), emit_nome: ent(tag(xml, 'xNome')), emit_ie: tag(xml, 'IE'), emissao: tag(xml, 'dhEmi') || null,
          valor: num(tag(xml, 'vNF')), tipo: num(tag(xml, 'tpNF')), situacao: num(tag(xml, 'cSitNFe')) })
        return
      }
      if (/^procNFe/.test(schema)) {
        const inf = tag(xml, 'infNFe'), chave = (xml.match(/Id="NFe(\d{44})"/) || [])[1] || tag(xml, 'chNFe'); if (!chave) return
        const emit = tag(inf, 'emit'), ide = tag(inf, 'ide'), tot = tag(tag(inf, 'total'), 'ICMSTot')
        const itens = todas(inf, 'det').map(d => { const p = tag(d, 'prod'), ipi = tag(tag(d, 'imposto'), 'IPI'); return {
          codigo: ent(tag(p, 'cProd')), descricao: ent(tag(p, 'xProd')), ean: tag(p, 'cEAN'), ncm: tag(p, 'NCM'), cfop: tag(p, 'CFOP'), unidade: ent(tag(p, 'uCom')),
          qtd: num(tag(p, 'qCom')), valor_un: num(tag(p, 'vUnCom')), valor: num(tag(p, 'vProd')), desconto: num(tag(p, 'vDesc')), ipi: num(tag(ipi, 'vIPI')) } })
        const dups = todas(tag(inf, 'cobr'), 'dup').map(d => ({ numero: tag(d, 'nDup'), vencimento: tag(d, 'dVenc'), valor: num(tag(d, 'vDup')) }))
        const caminho = `${usuario}/${chave}.xml.gz`
        const up = await fetch(`${supaUrl}/storage/v1/object/nfe/${caminho}`, { method: 'POST', headers: { apikey: supaKey, Authorization: `Bearer ${supaKey}`, 'Content-Type': 'application/gzip', 'x-upsert': 'true' }, body: await gzip(xml) })
        await gravar({ chave, nsu, emit_cnpj: tag(emit, 'CNPJ') || tag(emit, 'CPF'), emit_nome: ent(tag(emit, 'xNome')), emit_ie: tag(emit, 'IE'), emissao: tag(ide, 'dhEmi') || null,
          valor: num(tag(tot, 'vNF')), tipo: num(tag(ide, 'tpNF')), completa: true, itens, duplicatas: dups, xml_path: up.ok ? caminho : null })
        return
      }
      if (/^(resEvento|procEventoNFe)/.test(schema)) {
        const chave = tag(xml, 'chNFe'), tp = tag(xml, 'tpEvento')
        if (chave && tp === '110111') await db(`nfe_recebidas?usuario_id=eq.${usuario}&chave=eq.${chave}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ situacao: 3, atualizado_em: agora }) })
      }
    }
  } catch (e) {
    return resp({ error: String((e as Error)?.message || e) }, 500)
  }
})
