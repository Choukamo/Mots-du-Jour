import asyncio, json, os, sys, edge_tts
words=json.load(open(os.path.join(os.path.dirname(__file__),'words.json'),encoding='utf8'))
out=os.path.join(os.path.dirname(__file__),'web','public','audio'); os.makedirs(out,exist_ok=True)
VOICES={'fr':'fr-FR-DeniseNeural','zh':'zh-CN-XiaoxiaoNeural'}
sem=asyncio.Semaphore(4)
async def one(w,lang):
    path=f"{out}/{w['id']}_{lang}.mp3"
    if os.path.exists(path) and os.path.getsize(path)>1000: return
    text=w[lang]
    if lang=='fr':
        import re; text=re.sub(r'\s*\(.*?\)','',text)
    for attempt in range(5):
        try:
            async with sem:
                await edge_tts.Communicate(text,VOICES[lang],rate='-10%').save(path)
            return
        except Exception as e:
            await asyncio.sleep(2*(attempt+1))
    print('FAIL',w['id'],lang,file=sys.stderr)
async def main():
    await asyncio.gather(*[one(w,l) for w in words for l in ('fr','zh')])
asyncio.run(main())
print('done',len(os.listdir(out)))
