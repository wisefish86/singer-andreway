#!/usr/bin/env python3
"""Anytype Block v2 -> Notion, strict preview and safe import.

Requires NOTION_API_TOKEN, FTP_PASSWORD for --import. --check needs neither.
Dependencies for --import: requests. Offline --check needs only Python standard library.
"""
import argparse, io, json, os, re, sys, time, zipfile, hashlib, mimetypes, copy
from collections import Counter
from ftplib import FTP
from pathlib import PurePosixPath

# No parser dependency: controlled Markdown inline grammar with strict detection.
INLINE = re.compile(r'\*\*(.+?)\*\*|~~(.+?)~~|`([^`]+)`|(?<!\*)\*([^*\n]+)\*(?!\*)|\[([^\]\n]+)\]\((https?://[^\s)]+)\)|<font (color|background)="([a-zA-Z]+)">([^<]+)</font>', re.S)
FONT_COLOR = {'yellow':'yellow','red':'red','blue':'blue','green':'green','gray':'gray','grey':'gray','orange':'orange','purple':'purple','pink':'pink','brown':'brown'}
BLOCK_TYPES = {'paragraph','heading_1','heading_2','heading_3','toggle_heading_1','toggle_heading_2','toggle_heading_3','toggle','bulleted_list_item','numbered_list_item','quote','divider','callout','checkbox','code','table','image','bookmark','link'}
NOTION_API='https://api.notion.com/v1'
DATASOURCE='3e056f1afcfe80e1b558000bd0464a2b'
BASE='/www/andreway.ru/notion-import'

class Unsupported(ValueError): pass

def text_obj(content, *, bold=False, italic=False, strike=False, underline=False, code=False, url=None, color='default'):
    if len(content) > 2000: raise Unsupported('One inline span exceeds Notion limit')
    t={'type':'text','text':{'content':content}}
    if url: t['text']['link']={'url':url}
    t['annotations']={'bold':bold,'italic':italic,'strikethrough':strike,'underline':underline,'code':code,'color':color}
    return t

def split_text(value, **kw):
    return [text_obj(value[i:i+1800], **kw) for i in range(0, len(value), 1800)]

# AnyBlock v2 is NOT CommonMark. This parser implements the inline forms
# exercised in test ZIPs; unfamiliar tags/invalid constructs fail closed.
MARKUP = re.compile(r'(\\[\\*`\[\]~<>()_]|\*\*|~~|`|\*|\[[^\]\n]+\]\(https?://[^\s)]+\)|<u>|</u>|<font\s+[^>]*>|</font>|<mention\s+[^>]*>|</mention>)', re.S)
FONTS = re.compile(r'(color|background)=[\"\']([A-Za-z_]+)[\"\']')

def rich(src, *, raw=False):
    if not isinstance(src, str): raise Unsupported('Expected text string')
    if raw: return split_text(src)
    out=[]; active=[]; buffer=[]
    def attrs():
        d={'bold':False,'italic':False,'strike':False,'underline':False,'code':False,'color':'default'}
        for kind, value in active:
            if kind in ('bold','italic','strike','underline','code'): d[kind]=True
            if kind=='color': d['color']=value
        return d
    def flush():
        if buffer:
            out.extend(split_text(''.join(buffer), **attrs()))
            buffer.clear()
    i=0
    while i<len(src):
        m=MARKUP.search(src,i)
        if not m:
            buffer.append(src[i:]);break
        buffer.append(src[i:m.start()]); token=m.group()
        if token.startswith('\\'):
            buffer.append(token[1:]);i=m.end();continue
        # In inline code all markup except closing backtick is literal.
        if active and active[-1][0]=='code' and token!='`':
            buffer.append(token);i=m.end();continue
        if token.startswith('[') and '](' in token:
            flush(); label,url=token[1:].split('](',1);url=url[:-1]
            if url.startswith('anytype:'):
                raise Unsupported('Unexpected internal link syntax')
            out.extend(split_text(label,**dict(attrs(),url=url)));i=m.end();continue
        if token.startswith('<font '):
            kv=dict(FONTS.findall(token))
            if not kv or len(kv)!=len(re.findall(r'\b(?:color|background)=',token)):
                raise Unsupported('Malformed font mark: '+token)
            color=kv.get('background') or kv.get('color'); target=FONT_COLOR.get(color)
            if target is None:raise Unsupported('Unknown Anytype color: '+str(color))
            if 'background' in kv:target+='_background'
            flush(); active.append(('font',target));active.append(('color',target));i=m.end();continue
        if token=='</font>':
            if not active or active[-1][0]!='color':raise Unsupported('Unmatched font tag')
            flush();active.pop();active.pop();i=m.end();continue
        if token.startswith('<mention') or token=='</mention>':
            raise Unsupported('Anytype mention needs explicit text replacement')
        if token in ('<u>','</u>'):
            flush()
            if token=='<u>':active.append(('underline',True))
            elif active and active[-1][0]=='underline':active.pop()
            else:raise Unsupported('Unmatched underline tag')
            i=m.end();continue
        if src.startswith('***',m.start()):
            flush()
            if len(active)>=2 and [x[0] for x in active[-2:]]==['bold','italic']:
                active.pop();active.pop()
            elif len(active)>=2 and [x[0] for x in active[-2:]]==['italic','bold']:
                active.pop();active.pop()
            else:
                active.extend([('bold',True),('italic',True)])
            i=m.start()+3;continue
        kind={'**':'bold','~~':'strike','*':'italic','`':'code'}[token]
        flush()
        if active and active[-1][0]==kind:active.pop()
        else:active.append((kind,True))
        i=m.end()
    if active:raise Unsupported('Unclosed inline formatting: '+repr(active))
    flush()
    # Reject unrecognized known-tag shapes to prevent accidental silent loss.
    if any(re.search(r'</?(?:font|mention|u)\b',x['text']['content']) for x in out):
        raise Unsupported('Unparsed AnyBlock inline tag')
    return out

def plain_value(arr): return ''.join(v.get('plain_text',v.get('text',{}).get('content','')) for v in arr)

def scan_archive(data):
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        files=z.infolist()
        if len(files)>3000 or sum(f.file_size for f in files)>500_000_000: raise Unsupported('Archive too large')
        for f in files:
            p=PurePosixPath(f.filename)
            if f.filename.startswith('/') or '..' in p.parts: raise Unsupported('Unsafe archive filename')
        objs={}
        for f in files:
            if f.filename.startswith('objects/') and f.filename.endswith('.anyblock.json'):
                obj=json.loads(z.read(f));objs[obj.get('id')]=obj
        pages=[o for o in objs.values() if o.get('blocks')]
        # A single exported page may bundle linked objects with their own blocks.
        referenced={b.get('object_id') for o in pages for b in o.get('blocks',[]) if b.get('type')=='link'}
        roots=[o for o in pages if o.get('id') not in referenced]
        if len(roots)!=1: raise Unsupported('Cannot identify unique main document: '+str(len(roots)))
        doc=roots[0]
        title=doc.get('properties',{}).get('Name')
        if not isinstance(title,str) or not title.strip(): raise Unsupported('Missing note title')
        return z.namelist(),{n:z.read(n) for n in z.namelist()},doc,objs

def tree(blocks):
    roots=[];parents=[];previous=0
    for idx,b in enumerate(blocks):
        typ=b.get('type'); depth=b.get('indent',0)
        if typ not in BLOCK_TYPES:raise Unsupported(f'Block #{idx}: unsupported type {typ}')
        if not isinstance(depth,int) or depth<0 or (idx and depth>previous+1) or (not idx and depth):raise Unsupported(f'Block #{idx}: invalid indent {depth}')
        if depth and (len(parents)<depth or parents[depth-1]['type'] in ('image','table','divider','bookmark','link')):raise Unsupported(f'Block #{idx}: invalid nesting')
        node={'type':typ,'source':b,'children':[]}
        if depth: parents[depth-1]['children'].append(node)
        else: roots.append(node)
        parents=parents[:depth]+[node];previous=depth
    return roots

def convert(node,files,objects):
    b=node['source']; k=b['type']; children=node['children']
    if k=='divider':return {'object':'block','type':'divider','divider':{}}
    if k=='image':
        oid=b.get('object_id')
        candidates=[p for p in files if p.startswith('files/'+str(oid)+'.') and not p.endswith('.json')]
        if len(candidates)!=1:raise Unsupported(f'Image {oid} missing/ambiguous in ZIP')
        p=candidates[0];mime=mimetypes.guess_type(p)[0]
        if mime not in ('image/jpeg','image/png','image/gif','image/webp'):raise Unsupported('Unsupported image MIME '+str(mime))
        return {'__asset':p,'__mime':mime,'object':'block','type':'image'}
    if k=='link':
        target=objects.get(b.get('object_id'))
        if target is None:raise Unsupported('Linked Anytype object missing')
        name=(target.get('properties',{}).get('Name') if target else None) or 'название неизвестно'
        caption=f'[Здесь была ссылка на заметку «{name}»]'
        print('WARNING: internal Anytype link replaced with placeholder:',name)
        return {'object':'block','type':'paragraph','paragraph':{'rich_text':split_text(caption)}}
    if k=='bookmark':
        url=b.get('url')
        if not (isinstance(url,str) and url.startswith(('https://','http://'))):raise Unsupported('Bookmark without valid URL')
        return {'object':'block','type':'bookmark','bookmark':{'url':url}}
    if k=='table':
        cols=b.get('columns',[]);rows=b.get('rows',[])
        if not cols or not rows or len(cols)>100:raise Unsupported('Invalid table dimensions')
        width=len(cols); children_rows=[]
        for row in rows:
            vals=row.get('cells',[])
            if len(vals)>width:raise Unsupported('Table cell mismatch')
            vals=list(vals)+[None]*(width-len(vals))
            if not all(v is None or isinstance(v,str) for v in vals): raise Unsupported('Complex table cells not yet supported')
            children_rows.append({'object':'block','type':'table_row','table_row':{'cells':[rich(v or '') for v in vals]}})
        return {'object':'block','type':'table','table':{'table_width':width,'has_column_header':bool(rows[0].get('is_header',False)),'has_row_header':False,'children':children_rows}}
    aliases={'toggle':'toggle','callout':'callout','checkbox':'to_do','code':'code'}
    type_name=aliases.get(k,k.removeprefix('toggle_'))
    value={'rich_text':rich(b.get('text',''),raw=(k=='code'))}
    if k.startswith('toggle_heading_'):value['is_toggleable']=True
    if k=='checkbox': value['checked']=bool(b.get('checked',False))
    if k=='code':value['language']=b.get('language','plain text')
    if k=='callout':value['icon']={'type':'emoji','emoji':'💡'}
    if k=='toggle' and not children:value['children']=[]
    return {'object':'block','type':type_name,type_name:value}

def norm(b):
    k=b['type'];v=b.get(k,{})
    if k=='divider':return ('divider',)
    if k=='table':return ('table',len(v.get('children',[])),v.get('table_width'),tuple(tuple(tuple((x.get('text',{}).get('content'),x.get('annotations'),x.get('text',{}).get('link')) for x in cell) for cell in row['table_row']['cells']) for row in v.get('children',[])))
    if k=='image':return ('image',)
    if k=='bookmark':return ('bookmark',v['url'])
    def n(x):
        a=x.get('annotations') or {}
        return (x.get('text',{}).get('content'),tuple((key,a.get(key, False if key!='color' else 'default')) for key in ('bold','italic','strikethrough','underline','code','color')), (x.get('text',{}).get('link') or x.get('href') or {}).get('url') if isinstance(x.get('text',{}).get('link') or x.get('href'),dict) else x.get('href'))
    return (k,v.get('is_toggleable',False),v.get('checked'),tuple(n(x) for x in v.get('rich_text',[])))

def collect(blocks,files,objects):
    result=[]
    for n in blocks:
        a=convert(n,files,objects)
        result.append((a,collect(n['children'],files,objects)))
    return result

def preview(data):
    names,files,doc,objects=scan_archive(data)
    nodes=tree(doc['blocks']); converted=collect(nodes,files,objects)
    c=Counter(b['type'] for b in doc['blocks']);print('TITLE',doc['properties']['Name']);print('BLOCKS',len(doc['blocks']));print('TYPES',dict(c));print('READY',len(converted),'root blocks; nested blocks checked');return converted,files,doc

class Notion:
    def __init__(self):
        import requests
        self.r=requests.Session();self.r.headers.update({'Authorization':'Bearer '+os.environ['NOTION_API_TOKEN'],'Notion-Version':'2025-09-03'})
    def req(self,method,path,**kw):
        for trial in range(6):
            resp=self.r.request(method,NOTION_API+path,timeout=90,**kw)
            if resp.status_code in (429,500,502,503,504) and trial<5:
                time.sleep(max(int(resp.headers.get('Retry-After','1')),2**trial));continue
            resp.raise_for_status(); time.sleep(.36);return resp.json()
    def upload(self,path,bytes_,mime):
        obj=self.req('POST','/file_uploads',json={'mode':'single_part','filename':PurePosixPath(path).name,'content_type':mime})
        ident=obj['id']
        result=self.req('POST',f'/file_uploads/{ident}/send',files={'file':(PurePosixPath(path).name,bytes_,mime)})
        if result.get('status') not in ('uploaded','pending'):raise Unsupported('File upload not accepted')
        return ident
    def list_children(self,id_):
        out=[];cur=None
        while True:
            params={'page_size':100}
            if cur:params['start_cursor']=cur
            r=self.req('GET',f'/blocks/{id_}/children',params=params);out+=r['results']
            if not r.get('has_more'):return out
            cur=r['next_cursor']
    def create(self,title):
        return self.req('POST','/pages',json={'parent':{'type':'data_source_id','data_source_id':DATASOURCE},'properties':{'Name':{'title':[{'text':{'content':title[:2000]}}]},'Тип':{'select':{'name':'📄 Заметка'}}}})
    def find(self,title):
        r=self.req('POST',f'/data_sources/{DATASOURCE}/query',json={'filter':{'property':'Name','title':{'equals':title}},'page_size':10})
        if len(r['results'])>1 or r['has_more']:raise Unsupported('Duplicate Notion title')
        return r['results'][0] if r['results'] else None
    def append_verified(self,parent,converted,files):
        # Sequential small groups to obtain child IDs, verify each and recurse.
        for block,children in converted:
            request=json.loads(json.dumps(block))
            if '__asset' in request:
                path=request.pop('__asset');mime=request.pop('__mime'); id_=self.upload(path,files[path],mime)
                request['image']={'type':'file_upload','file_upload':{'id':id_}}
            created=self.req('PATCH',f'/blocks/{parent}/children',json={'children':[request]})['results'][0]
            actual=self.req('GET','/blocks/'+created['id'])
            typ=request['type']
            if actual['type']!=typ:raise Unsupported('Notion returned wrong block type')
            if typ=='image':
                if actual['image']['type']!='file':raise Unsupported('Image is not stored in Notion')
            elif typ=='table':
                rows=self.list_children(created['id']); exp=request['table']['children']
                if len(rows)!=len(exp):raise Unsupported('Table row count changed')
                for i,(a,e) in enumerate(zip(rows,exp)):
                    if a['table_row']['cells']!=e['table_row']['cells']:
                        # Notion adds metadata to rich text on read; verify plain text.
                        if [[plain_value(c) for c in a['table_row']['cells']]]!=[[plain_value(c) for c in e['table_row']['cells']]]:
                            raise Unsupported('Table cell mismatch')
            else:
                exp=norm(request); act=norm(actual)
                # API may normalize null annotation/color keys; check content + flags separately.
                if exp!=act:raise Unsupported('Block payload mismatch after write: '+typ)
            if children:self.append_verified(created['id'],children,files)
    def import_one(self,data):
        converted,files,doc=preview(data)
        title=doc['properties']['Name']; existing=self.find(title)
        if existing:
            # Safest strategy: do not mutate an existing page until conflict-resolution is implemented.
            raise Unsupported('Page already exists: refusing overwrite '+existing['id'])
        page=self.create(title)
        self.append_verified(page['id'],converted,files)
        print('VERIFIED and archived:',title,'Notion page:',page['id'],'URL:',page.get('url',''))
        return page

def main():
    p=argparse.ArgumentParser();p.add_argument('--check',metavar='ZIP');p.add_argument('--import-ftp',action='store_true');args=p.parse_args()
    if args.check:
        with open(args.check,'rb') as f:preview(f.read());return
    if args.import_ftp:
        api=Notion();ftp=FTP('andreway.ru',timeout=60);ftp.login('andreway',os.environ['FTP_PASSWORD']);ftp.cwd(BASE+'/01_Inbox')
        names=[n.split('/')[-1] for n in ftp.nlst() if n.lower().endswith('.zip')]
        print('ZIP archives found:',len(names));passed=failed=0
        for name in names:
            try:
                buf=io.BytesIO();ftp.retrbinary('RETR '+BASE+'/01_Inbox/'+name,buf.write)
                api.import_one(buf.getvalue())
                # Only archive after full Notion API verification
                ftp.rename(BASE+'/01_Inbox/'+name,BASE+'/02_Done/'+name);passed+=1
            except Exception as e:
                failed+=1;print('FAILED, ZIP retained:',name,type(e).__name__,str(e)[:250])
        ftp.quit();print('RESULT',{'verified':passed,'failed':failed})
        if failed:sys.exit(1)
        return
    p.error('Choose --check or --import-ftp')
if __name__=='__main__':main()