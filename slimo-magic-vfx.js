'use strict';

const SlimoMagicVfx = (() => {
  function create(T,scene,world) {
    const active=new Map(),object=new T.Object3D();
    const shapes={box:new T.BoxGeometry(1,1,1),crystal:new T.ConeGeometry(.5,1,5),
      rock:new T.IcosahedronGeometry(1,0),ring:new T.TorusGeometry(1,.035,5,48),halo:new T.RingGeometry(.92,1,48)};
    function material(color,glow=false) {return glow?new T.MeshBasicMaterial({color,transparent:true,opacity:.8,depthWrite:false,side:T.DoubleSide}):
      new T.MeshStandardMaterial({color,emissive:color,emissiveIntensity:.22,roughness:.7,flatShading:true});}
    function mesh(geometry,mat,group,x=0,y=0,z=0) {const m=new T.Mesh(geometry,mat);m.position.set(x,y,z);group.add(m);return m;}
    function make(effect) {
      const definition=world.spells[effect.key],group=new T.Group(),mat=material(definition.color),glow=material(definition.color,true);
      group.position.set(effect.x,0,effect.z);scene.add(group);
      const sigil=mesh(shapes.halo,glow,group,0,.06,0);sigil.rotation.x=-Math.PI/2;
      const pieces=[],rings=[];
      if(effect.key==='earthwall'){
        const count=4+effect.rank,blocks=new T.InstancedMesh(shapes.box,mat,count);
        const caps=new T.InstancedMesh(shapes.crystal,glow,count);group.add(blocks,caps);pieces.push(blocks,caps);
      }else if(effect.key==='embertrail'){
        for(let i=0;i<3+effect.rank;i++)pieces.push(mesh(shapes.crystal,glow,group,Math.sin(effect.aim)*(2+i*1.25),.4,Math.cos(effect.aim)*(2+i*1.25)));
      }else if(effect.key==='frostbloom'){
        for(let i=0;i<6+effect.rank*2;i++)pieces.push(mesh(shapes.crystal,mat,group));
      }else if(effect.key==='vortex'||effect.key==='stormcoil'){
        for(let i=0;i<4;i++){const m=mesh(shapes.ring,glow,group,0,.25+i*.55,0);m.rotation.x=Math.PI/2;rings.push(m);}
        if(effect.key==='stormcoil'){
          const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.BufferAttribute(new Float32Array(24*3),3));
          const bolt=new T.Line(geometry,new T.LineBasicMaterial({color:0xf9e9ff,transparent:true,opacity:.9}));group.add(bolt);pieces.push(bolt);
        }
      }else if(effect.key==='stoneburst'){
        for(let i=0;i<3+effect.rank*2;i++)pieces.push(mesh(shapes.rock,mat,group));
      }else if(effect.key==='mending'){
        for(let i=0;i<5+effect.rank;i++){
          const cross=new T.Group();group.add(cross);mesh(shapes.box,glow,cross).scale.set(.09,.44,.09);mesh(shapes.box,glow,cross).scale.set(.34,.09,.09);pieces.push(cross);
        }
      }else if(effect.key==='starfall'){
        pieces.push(mesh(shapes.rock,mat,group,0,9,0));
        const trail=mesh(shapes.crystal,glow,group,0,10,0);trail.rotation.z=Math.PI;pieces.push(trail);
        for(let i=0;i<2;i++){const m=mesh(shapes.halo,glow,group,0,.08+i*.03,0);m.rotation.x=-Math.PI/2;rings.push(m);}
      }
      const count=24+effect.rank*8,positions=new Float32Array(count*3),geometry=new T.BufferGeometry();
      geometry.setAttribute('position',new T.BufferAttribute(positions,3).setUsage(T.DynamicDrawUsage));
      const sparks=new T.Points(geometry,new T.PointsMaterial({color:definition.color,size:.07,transparent:true,opacity:.75,depthWrite:false}));
      sparks.frustumCulled=false;group.add(sparks);
      return {group,mat,glow,sigil,pieces,rings,sparks,positions,key:effect.key};
    }
    function remove(id) {
      const item=active.get(id);if(!item)return;
      scene.remove(item.group);
      // Geometry in shapes is shared. Only per-effect attributes/materials are released.
      const geometries=new Set(),materials=new Set();
      item.group.traverse(m=>{
        if(m.geometry&&!Object.values(shapes).includes(m.geometry))geometries.add(m.geometry);
        if(m.material)materials.add(m.material);
        if(m.isInstancedMesh)m.dispose?.();
      });
      for(const g of geometries)g.dispose();for(const m of materials)m.dispose();active.delete(id);
    }
    function update(packet,now,player,settings) {
      const seen=new Set(),delta=packet?Math.max(0,(now-packet.receivedAt)/1000):0;
      for(const effect of packet?.effects||[]){
        if(seen.size>=64||Math.hypot(effect.x-player.x,effect.z-player.z)>65)continue;
        const age=effect.age+delta;if(age>=effect.duration)continue;
        seen.add(effect.id);let m=active.get(effect.id);
        if(!m){m=make(effect);active.set(effect.id,m);}
        const level=world.spells[effect.key].levels[effect.rank-1],t=Math.min(1,age/effect.duration);
        const fade=Math.min(1,Math.max(0,(effect.duration-age)/.4)),motion=settings.reduced?0:age;
        const intensity=settings.reduced?.6:1;
        m.glow.opacity=.7*fade*intensity;m.sparks.material.opacity=.7*fade*intensity;
        m.sigil.scale.setScalar((level.radius||level.width*.55||2)*Math.min(1,.25+age*3));
        m.sigil.rotation.z=motion*.35;m.group.visible=true;
        if(effect.key==='earthwall'){
          const segments=world.wallSegments(effect),[blocks,caps]=m.pieces;
          segments.forEach((segment,i)=>{
            const rise=settings.reduced?1:Math.max(0,Math.min(1,(age-i*.035)/.28));
            const height=level.height*rise*Math.min(1,(effect.duration-age)/.35);
            object.position.set(segment.x-effect.x,height/2-.06,segment.z-effect.z);object.rotation.set(0,effect.aim,Math.sin(i*2)*.045);
            object.scale.set(level.width/segments.length*1.06,Math.max(.01,height),.84);object.updateMatrix();blocks.setMatrixAt(i,object.matrix);
            object.position.y=height+.12;object.rotation.z=0;object.scale.set(.28,.45*rise,.28);object.updateMatrix();caps.setMatrixAt(i,object.matrix);
          });blocks.instanceMatrix.needsUpdate=true;caps.instanceMatrix.needsUpdate=true;
        }else if(effect.key==='embertrail'){
          m.pieces.forEach((piece,i)=>{const erupt=Math.max(0,Math.min(1,(age-level.delay)*5)),flicker=settings.reduced?1:.85+Math.sin(motion*17+i*3)*.15;
            piece.scale.set(.65+effect.rank*.1,Math.max(.02,erupt*(1.7+effect.rank*.35)*flicker),.65);piece.position.y=piece.scale.y/2;});
        }else if(effect.key==='frostbloom'){
          m.pieces.forEach((piece,i)=>{const a=i*Math.PI*2/m.pieces.length,spread=Math.min(1,age/level.delay)*level.radius*.8;
            piece.position.set(Math.sin(a)*spread,.28+Math.min(1,Math.max(0,age-level.delay)*7)*.65,Math.cos(a)*spread);
            piece.scale.set(.35,.65+effect.rank*.25,.35);piece.rotation.set(Math.sin(a)*.5,motion*.2,Math.cos(a)*.5);});
        }else if(effect.key==='vortex'||effect.key==='stormcoil'){
          m.rings.forEach((ring,i)=>{ring.scale.setScalar((level.radius||4)*(.25+i*.15));ring.rotation.y=motion*(1+i*.18);ring.position.x=Math.sin(motion*3+i)*.09;});
          const bolt=m.pieces[0];if(bolt){const positions=bolt.geometry.attributes.position;
            const links=[{x:effect.x,z:effect.z},...(effect.links||[])];
            for(let i=0;i<positions.count;i++){
              if(links.length>1){const index=Math.min(links.length-2,Math.floor(i/6)),a=links[index],b=links[index+1],t=(i%6)/5,jitter=settings.reduced?0:Math.sin(i*4.1+motion*13)*.12;
                positions.setXYZ(i,a.x+(b.x-a.x)*t-effect.x,1.1+jitter,a.z+(b.z-a.z)*t-effect.z);
              }else{const a=i*.7+motion*12;positions.setXYZ(i,Math.sin(a)*(level.radius*.65),.4+(i%5)*.36,Math.cos(a)*(level.radius*.65));}
            }positions.needsUpdate=true;}
        }else if(effect.key==='stoneburst'){
          m.pieces.forEach((piece,i)=>{const a=effect.aim+(i/(m.pieces.length-1)-.5)*.95,d=1.2+age*16;
            piece.visible=age<.14;piece.position.set(Math.sin(a)*d,.8+Math.sin(age*8+i)*.08,Math.cos(a)*d);piece.scale.setScalar(.17+effect.rank*.045);piece.rotation.set(motion*5+i,motion*7,0);});
        }else if(effect.key==='mending'){
          m.pieces.forEach((piece,i)=>{const a=i*2.4+motion*.6;piece.position.set(Math.sin(a)*(1+i*.08),.3+(motion*.9+i*.2)%2.3,Math.cos(a)*(1+i*.08));piece.rotation.y=-motion*.5;});
        }else if(effect.key==='starfall'){
          const fall=Math.min(1,age/level.delay),impact=Math.max(0,(age-level.delay)/(.6));
          m.pieces[0].position.y=settings.reduced?.8:.5+(1-fall)*9;m.pieces[0].scale.setScalar((.45+effect.rank*.12)*(impact?Math.max(0,1-impact):1));
          m.pieces[0].rotation.set(motion*2,motion*3,0);m.pieces[1].position.y=m.pieces[0].position.y+1;
          m.pieces[1].scale.set(.45,1.8,.45);m.pieces[1].visible=age<level.delay;
          m.rings.forEach((ring,i)=>{ring.scale.setScalar(level.radius*(age<level.delay?1:1+impact*(1+i*.4)));});
        }
        for(let i=0;i<m.positions.length/3;i++){
          const a=i*2.399+motion*(effect.key==='vortex'?5:1),radius=(level.radius||2)*(.35+(i%7)/10);
          m.positions[i*3]=Math.sin(a)*radius;m.positions[i*3+1]=.15+((i*.17+motion*.6)%1)*(effect.key==='vortex'?3.2:1.5);m.positions[i*3+2]=Math.cos(a)*radius;
        }
        m.sparks.geometry.attributes.position.needsUpdate=true;
      }
      for(const id of active.keys())if(!seen.has(id))remove(id);
    }
    return {update,clear(){for(const id of [...active.keys()])remove(id);},get count(){return active.size;}};
  }
  return Object.freeze({create});
})();
