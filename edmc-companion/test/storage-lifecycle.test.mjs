import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { audioFixture } from "./helpers/audio.mjs";
import http from "node:http";
import { Companion } from "../src/companion.mjs";
import { Storage, parseMountInfo, visibleMounts } from "../src/storage.mjs";
import { JobQueue } from "../src/job-queue.mjs";

async function fixture(t) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "edmc-storage-test-"));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const a = path.join(root, "A"), b = path.join(root, "B");
    await fs.mkdir(a); await fs.mkdir(b);
    let volumes = [a,b].map((rootPath, i) => ({ rootPath, id: `uuid:${i}`, instance: `uuid:${i}:1`, kind: "usb", writable: true }));
    const options = { dataDir: path.join(root, "state"), chromiumExecutable: "unused", origin: "http://127.0.0.1:17642",
        storageOptions: { enumerate: async () => volumes, pin: false } };
    const c = new Companion(options); await c.initialize();
    return { c,a,b,options,setVolumes: (v) => {volumes=v;},getVolumes:()=>volumes };
}
const idle = async (c) => {
    const deadline = Date.now() + 5000;
    while (c.jobs.hasActiveJobs() && Date.now() < deadline) await new Promise(r=>setTimeout(r,5));
    assert.equal(c.jobs.hasActiveJobs(),false);
};

test("mountinfo parser decodes escaped paths and read-only state", () => {
    const [v] = parseMountInfo("89 22 8:17 / /media/pi/My\\040USB ro,nosuid - exfat /dev/sdb1 rw\n");
    assert.equal(v.rootPath,"/media/pi/My USB"); assert.equal(v.writable,false);
});

test("stacked USB mounts use kernel-visible identity, independent of list order", async () => {
    const hidden={rootPath:'/media/pi/USB',mountId:'381'};
    const top={rootPath:'/media/pi/USB',mountId:'384'};
    const other={rootPath:'/media/pi/Other',mountId:'400'};
    const id=async p=>p===other.rootPath?'400':'384';
    assert.deepEqual(await visibleMounts([hidden,top,other],id),[top,other]);
    assert.deepEqual(await visibleMounts([top,hidden,other],id),[top,other]);
    assert.deepEqual(await visibleMounts([hidden,top],async()=> '999'),[]);
    assert.deepEqual(await visibleMounts([hidden,top],async()=> {throw new Error('removed');}),[]);
});

test("remembered missing USB starts on explicit SD, never recreates mount directory", async t => {
    const f=await fixture(t); await f.c.setStorage(f.a);
    f.setVolumes([]); await fs.rename(f.a,f.a+'-removed');
    const c=new Companion(f.options); await c.initialize();
    assert.equal(c.status().storage.kind,"sd");
    assert.equal(c.status().storage.requestedRoot,f.a);
    assert.match(c.status().storage.message,/using SD/);
    await assert.rejects(fs.stat(f.a),{code:'ENOENT'});
});

test("unmounted writable directory is rejected; fallback does not use that directory", async t => {
    const f=await fixture(t); await f.c.setStorage(f.a);
    f.setVolumes([]);
    await f.c.refreshStorage();
    assert.equal(f.c.activeVolume.kind,"sd");
    await assert.rejects(f.c.setStorage(f.a),/missing/);
    assert.equal(f.c.activeVolume.kind,"sd");
    assert.equal(f.c.stateStore.value.usbRoot,f.a);
});

test("two USBs are listed separately and invalid selection preserves active and saved selection", async t => {
    const f=await fixture(t); await f.c.setStorage(f.a);
    assert.equal(f.c.status().storage.volumes.filter(v=>v.kind==='usb').length,2);
    await assert.rejects(f.c.setStorage(path.join(f.a,'unmounted')),/missing/);
    assert.equal(f.c.activeVolume.rootPath,f.a); assert.equal(f.c.stateStore.value.usbRoot,f.a);
    await f.c.setStorage(f.b); assert.equal(f.c.activeVolume.rootPath,f.b);
});

test("drive switches are rejected for queued or running downloads", async t => {
    const f=await fixture(t); await f.c.setStorage(f.a);
    let done; const gate=new Promise(r=>{done=r;});
    f.c.jobs.enqueue('download',{},()=>gate);
    await assert.rejects(f.c.setStorage(f.b),/Finish or cancel/);
    done(); await idle(f.c);
    await f.c.setStorage(f.b);
});

test("fallback can be disabled and a same-path different USB is not mistaken for the saved one", async t => {
    const f=await fixture(t); await f.c.setStorage(f.a);
    await f.c.setSettings({fallbackToSd:false});
    f.setVolumes([{...f.getVolumes()[0],id:'uuid:other',instance:'other:2'}]);
    await f.c.refreshStorage(); assert.equal(f.c.activeVolume,null);
    assert.equal(f.c.stateStore.value.storageId,'uuid:0');
});

test("duplicate download restores release state and carries immutable storage identity", async t => {
    const f=await fixture(t); await f.c.setStorage(f.a);
    await fs.writeFile(path.join(f.a,'track.mp3'),await audioFixture('mp3'));
    const entry={providerId:'moivo1mapbvk',topicId:42,relativePath:'track.mp3'};
    await f.c.usbLibrary.commitTrack(entry);
    await f.c.stateStore.update(s=>{s.releases=[{topicId:42,title:'fixture',providers:[{providerId:entry.providerId}]}];});
    f.c.enqueueDownload(42); await idle(f.c);
    assert.equal(f.c.jobs.list()[0].state,'completed');
    assert.equal(f.c.jobs.list()[0].result.duplicate,true);
    assert.equal(f.c.releases()[0].download.storageRoot,f.a);
    assert.equal(f.c.releases()[0].download.storageId,'uuid:0');
    await f.c.setStorage(f.b);
    assert.equal(f.c.releases()[0].download.storageRoot,f.a);
    await f.c.setStorage(f.a); assert.equal(f.c.releases()[0].download.relativePath,'track.mp3');
});

test("prepare eject excludes only that USB and moves new work to SD", async t => {
    const f=await fixture(t); await f.c.setStorage(f.a);
    await f.c.prepareEject(f.a);
    assert.equal(f.c.activeVolume.kind,'sd');
    await assert.rejects(f.c.storage.resolve(f.a),/ejected/);
    await f.c.setStorage(f.b); assert.equal(f.c.activeVolume.rootPath,f.b);
});

test("history retention never evicts an active job", async () => {
    const q=new JobQueue({retain:1}); let finish;
    const first=q.enqueue('held',{},()=>new Promise(r=>{finish=r;}));
    await new Promise(r=>setImmediate(r));
    q.enqueue('later',{},async()=>{}); q.enqueue('later',{},async()=>{});
    assert(q.list().some(j=>j.id===first.id)); assert.equal(q.cancel(first.id),true);
    finish();
});

test("Linux pinned directory cannot redirect writes into a replacement mountpoint", {skip:process.platform!=='linux'}, async t => {
    const f=await fixture(t);
    const storage=new Storage(f.options.dataDir,{enumerate:async()=>f.getVolumes(),pin:true});
    const volume=await storage.resolve(f.a);
    const session=await storage.open(volume,{});
    try {
        await fs.rename(f.a,f.a+'-original'); await fs.mkdir(f.a);
        await fs.writeFile(path.join(session.library.rootPath,'proof'),'original');
        assert.equal(await fs.readFile(path.join(f.a+'-original','proof'),'utf8'),'original');
        await assert.rejects(fs.stat(path.join(f.a,'proof')),{code:'ENOENT'});
    } finally {await session.close();}
});

test("low-space destination remains readable but rejects new download allocation", async t => {
    const f=await fixture(t);
    const storage=new Storage(f.options.dataDir,{enumerate:async()=>f.getVolumes(),pin:false,
        statfs:async()=>({bavail:1,bsize:4096})});
    const session=await storage.open(await storage.resolve(f.a),{});
    try {
        await session.check();
        await assert.rejects(session.check(100),/nearly full/);
    } finally {await session.close();}
});

test("safe-eject cancels an actual streaming download and releases its storage session", async t => {
    const f=await fixture(t); await f.c.setStorage(f.a);
    let received;
    const started=new Promise(resolve=>{received=resolve;});
    const server=http.createServer((request,response)=>{
        response.writeHead(200,{'content-type':'audio/mpeg','content-length':'100000'});
        response.write('ID3first-chunk'); received(); // remain open until cancellation
    });
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    t.after(()=>{server.closeAllConnections(); server.close();});
    const url=`http://127.0.0.1:${server.address().port}/fixture`;
    const locator={filter(){return this;},async count(){return 1;},async click(){}};
    f.c.browser.page=async()=>({async goto(){},locator:()=>locator,
        async waitForRequest(){return {url:()=>url};},context:()=>({cookies:async()=>[]}),async close(){}});
    await f.c.stateStore.update(s=>{s.releases=[{topicId:99,title:'fixture',providers:[{providerId:'fixture99'}]}];});
    f.c.enqueueDownload(99);
    await started;
    await f.c.prepareEject(f.a);
    await idle(f.c);
    assert.equal(f.c.jobs.list()[0].state,'cancelled');
    assert.equal(f.c.activeDownload,null);
    assert.equal(f.c.activeVolume.kind,'sd');
    assert.equal(f.c.releases()[0].download,undefined);
    assert.deepEqual(await fs.readdir(path.join(f.a,'.bitedj/edmc/incoming')),[]);
    await f.c.cancelEject(f.a);
    assert.equal(f.c.activeVolume.rootPath,f.a);
});
