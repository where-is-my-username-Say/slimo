'use strict';

// Adapts the authenticated relay to the duel's existing connection interface.
// Each pairing gets a new logical connection while the host keeps its socket.
globalThis.SlimoDuelTransport={
  create({url,onConnection,onReady,onError,WebSocketClass=WebSocket}) {
    const ws=new WebSocketClass(url);ws.binaryType='arraybuffer';
    let current=null,closed=false,connected=false,lastSeen=performance.now();
    const emit=(map,name,value)=>{for(const fn of map.get(name)||[])fn(value);};
    function endCurrent() {
      const old=current;current=null;if(!old)return;
      old.open=false;old.motion.readyState='closed';emit(old.events,'close');
    }
    function fail(message) { if(closed)return;closed=true;clearInterval(heartbeat);endCurrent();ws.close();onError(message); }
    function pair() {
      if(current)return;
      const events=new Map(),motionEvents=new Map();
      const motion={readyState:'open',get bufferedAmount(){return ws.bufferedAmount||0;},binaryType:'arraybuffer',
        addEventListener(name,fn){if(!motionEvents.has(name))motionEvents.set(name,[]);motionEvents.get(name).push(fn);},
        send(data){if(ws.readyState!==1)throw Error('Relay closed');ws.send(data);},
        close(){this.readyState='closed';emit(motionEvents,'close');}};
      const connection={relay:true,open:true,events,motion,dataChannel:ws,
        on(name,fn){if(!events.has(name))events.set(name,[]);events.get(name).push(fn);return this;},
        send(packet){if(this.open&&ws.readyState===1)ws.send(JSON.stringify(packet));},
        close(){if(!this.open)return;this.open=false;if(current===this)current=null;motion.close();
          if(ws.readyState===1)ws.send(JSON.stringify({relay:'leave'}));},
        deliver(data){if(data instanceof ArrayBuffer)emit(motionEvents,'message',{data});else emit(events,'data',data);}};
      current=connection;onConnection(connection);emit(events,'open');
    }
    ws.addEventListener('message',event=>{
      if(closed)return;lastSeen=performance.now();
      if(event.data instanceof ArrayBuffer){current?.deliver(event.data);return;}
      let packet;try{packet=JSON.parse(event.data);}catch{return;}
      if(packet.relay==='connected'){connected=true;onReady?.();}
      else if(packet.relay==='paired')pair();
      else if(packet.relay==='waiting'){endCurrent();}
      else if(packet.relay==='ended')fail(packet.message||'The host left the room.');
      else if(!packet.relay)current?.deliver(packet);
    });
    ws.addEventListener('close',()=>{if(!closed)fail(connected?'Duel connection lost. Reopen the room or rejoin.':'Could not join this room. Ask for a fresh invitation.');});
    ws.addEventListener('error',()=>fail('Could not connect to this duel. Ask the host for a fresh invitation and check your connection.'));
    const heartbeat=setInterval(()=>{
      if(closed)return;
      if(performance.now()-lastSeen>25000)return fail('Duel server stopped responding. Rejoin the room.');
      if(ws.readyState===1&&(ws.bufferedAmount||0)<4096)ws.send(JSON.stringify({relay:'ping'}));
    },5000);
    return {destroyed:false,destroy(){if(closed)return;closed=true;this.destroyed=true;clearInterval(heartbeat);
      const old=current;current=null;if(old){old.open=false;old.motion.close();}ws.close();},
      get connected(){return connected&&!closed;}};
  }
};
