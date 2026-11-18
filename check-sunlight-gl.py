import ctypes as C, ctypes.util, json, sys
E=C.CDLL(ctypes.util.find_library('EGL'))
E.eglGetProcAddress.argtypes=[C.c_char_p];E.eglGetProcAddress.restype=C.c_void_p
P=C.CFUNCTYPE(C.c_void_p,C.c_uint,C.c_void_p,C.POINTER(C.c_int))(E.eglGetProcAddress(b'eglGetPlatformDisplayEXT'))
d=P(0x31DD,None,None)
E.eglInitialize.argtypes=[C.c_void_p,C.POINTER(C.c_int),C.POINTER(C.c_int)];E.eglInitialize.restype=C.c_uint
major,minor=C.c_int(),C.c_int()
if not E.eglInitialize(d,C.byref(major),C.byref(minor)):raise RuntimeError('Surfaceless EGL unavailable')
E.eglBindAPI.argtypes=[C.c_uint];E.eglBindAPI(0x30A0)
attrs=(C.c_int*15)(0x3033,1,0x3040,4,0x3024,8,0x3023,8,0x3022,8,0x3021,8,0x3025,0,0x3038)
cfg=C.c_void_p();count=C.c_int();E.eglChooseConfig.argtypes=[C.c_void_p,C.POINTER(C.c_int),C.POINTER(C.c_void_p),C.c_int,C.POINTER(C.c_int)]
if not E.eglChooseConfig(d,attrs,C.byref(cfg),1,C.byref(count)) or not count.value:raise RuntimeError('No ES2 config')
E.eglCreatePbufferSurface.argtypes=[C.c_void_p,C.c_void_p,C.POINTER(C.c_int)];E.eglCreatePbufferSurface.restype=C.c_void_p
surface=E.eglCreatePbufferSurface(d,cfg,(C.c_int*5)(0x3057,16,0x3056,16,0x3038))
E.eglCreateContext.argtypes=[C.c_void_p,C.c_void_p,C.c_void_p,C.POINTER(C.c_int)];E.eglCreateContext.restype=C.c_void_p
ctx=E.eglCreateContext(d,cfg,None,(C.c_int*3)(0x3098,2,0x3038))
E.eglMakeCurrent.argtypes=[C.c_void_p,C.c_void_p,C.c_void_p,C.c_void_p]
if not E.eglMakeCurrent(d,surface,surface,ctx):raise RuntimeError('Cannot activate ES2 context')
def gl(name,ret,*args):return C.CFUNCTYPE(ret,*args)(E.eglGetProcAddress(name.encode()))
create=gl('glCreateShader',C.c_uint,C.c_uint);source=gl('glShaderSource',None,C.c_uint,C.c_int,C.POINTER(C.c_char_p),C.POINTER(C.c_int));compile_=gl('glCompileShader',None,C.c_uint)
status=gl('glGetShaderiv',None,C.c_uint,C.c_uint,C.POINTER(C.c_int));log=gl('glGetShaderInfoLog',None,C.c_uint,C.c_int,C.POINTER(C.c_int),C.c_void_p)
program=gl('glCreateProgram',C.c_uint);attach=gl('glAttachShader',None,C.c_uint,C.c_uint);link=gl('glLinkProgram',None,C.c_uint);pstatus=gl('glGetProgramiv',None,C.c_uint,C.c_uint,C.POINTER(C.c_int));plog=gl('glGetProgramInfoLog',None,C.c_uint,C.c_int,C.POINTER(C.c_int),C.c_void_p)
for i,shader in enumerate(json.load(open(sys.argv[1]))):
 handles=[]
 for typ,key in [(0x8B31,'vertex'),(0x8B30,'fragment')]:
  text=('precision highp float; precision highp int;\n'+('attribute vec3 position; attribute vec2 uv;\n' if key=='vertex' else '')+shader[key]).encode();h=create(typ);v=C.c_char_p(text);source(h,1,C.byref(v),None);compile_(h);ok=C.c_int();status(h,0x8B81,C.byref(ok))
  if not ok.value:
   buf=C.create_string_buffer(10000);log(h,10000,None,buf);raise RuntimeError(f'{i} {key}: '+buf.value.decode())
  handles.append(h)
 pr=program()
 for h in handles:attach(pr,h)
 link(pr);ok=C.c_int();pstatus(pr,0x8B82,C.byref(ok))
 if not ok.value:
  buf=C.create_string_buffer(10000);plog(pr,10000,None,buf);raise RuntimeError(buf.value.decode())
 print('Sunlight pass',i+1,'compiled and linked in Mesa OpenGL ES')
 # Render the scattering pass against controlled scene/shadow depth maps.
 if i==0:
  use=gl('glUseProgram',None,C.c_uint);use(pr)
  loc=gl('glGetUniformLocation',C.c_int,C.c_uint,C.c_char_p)
  one=gl('glUniform1i',None,C.c_int,C.c_int);two=gl('glUniform2f',None,C.c_int,C.c_float,C.c_float);three=gl('glUniform3f',None,C.c_int,C.c_float,C.c_float,C.c_float)
  matrix=gl('glUniformMatrix4fv',None,C.c_int,C.c_int,C.c_ubyte,C.POINTER(C.c_float))
  identity=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]
  for name in ['inverseProjection','cameraWorld']:matrix(loc(pr,name.encode()),1,0,(C.c_float*16)(*identity))
  matrix(loc(pr,b'shadowMatrix'),1,0,(C.c_float*16)(.001,0,0,0,0,.001,0,0,0,0,.001,0,.5,.5,.5,1))
  three(loc(pr,b'eye'),0,0,0);three(loc(pr,b'sunDirection'),0,0,1);three(loc(pr,b'sunColor'),1,1,1);two(loc(pr,b'shadowTexel'),.25,.25);one(loc(pr,b'steps'),12)
  genTex=gl('glGenTextures',None,C.c_int,C.POINTER(C.c_uint));active=gl('glActiveTexture',None,C.c_uint);bindTex=gl('glBindTexture',None,C.c_uint,C.c_uint)
  param=gl('glTexParameteri',None,C.c_uint,C.c_uint,C.c_int);texImage=gl('glTexImage2D',None,C.c_uint,C.c_int,C.c_int,C.c_int,C.c_int,C.c_int,C.c_uint,C.c_uint,C.c_void_p)
  textures=(C.c_uint*2)();genTex(2,textures)
  for unit,name in [(0,b'sceneDepth'),(1,b'shadowDepth')]:
   active(0x84C0+unit);bindTex(0x0DE1,textures[unit]);param(0x0DE1,0x2801,0x2600);param(0x0DE1,0x2800,0x2600);one(loc(pr,name),unit)
  genBuffer=gl('glGenBuffers',None,C.c_int,C.POINTER(C.c_uint));bindBuffer=gl('glBindBuffer',None,C.c_uint,C.c_uint);bufferData=gl('glBufferData',None,C.c_uint,C.c_ssize_t,C.c_void_p,C.c_uint)
  buf=C.c_uint();genBuffer(1,C.byref(buf));bindBuffer(0x8892,buf)
  vertices=(C.c_float*30)(-1,-1,0,0,0,1,-1,0,1,0,-1,1,0,0,1,-1,1,0,0,1,1,-1,0,1,0,1,1,0,1,1);bufferData(0x8892,C.sizeof(vertices),vertices,0x88E4)
  attr=gl('glGetAttribLocation',C.c_int,C.c_uint,C.c_char_p);enable=gl('glEnableVertexAttribArray',None,C.c_uint);pointer=gl('glVertexAttribPointer',None,C.c_uint,C.c_int,C.c_uint,C.c_ubyte,C.c_int,C.c_void_p)
  for name,n,offset in [(b'position',3,0),(b'uv',2,12)]:
   index=attr(pr,name);enable(index);pointer(index,n,0x1406,0,20,C.c_void_p(offset))
  viewport=gl('glViewport',None,C.c_int,C.c_int,C.c_int,C.c_int);draw=gl('glDrawArrays',None,C.c_uint,C.c_int,C.c_int);read=gl('glReadPixels',None,C.c_int,C.c_int,C.c_int,C.c_int,C.c_uint,C.c_uint,C.c_void_p);viewport(0,0,16,16)
  def sample(shadow,depth):
   for unit,rgba in [(0,[depth,0,0,255]),(1,[shadow]*4)]:
    active(0x84C0+unit);bindTex(0x0DE1,textures[unit]);data=(C.c_ubyte*64)(*(rgba*16));texImage(0x0DE1,0,0x1908,4,4,0,0x1908,0x1401,data)
   draw(4,0,6);out=(C.c_ubyte*4)();read(8,8,1,1,0x1908,0x1401,out);return sum(out[:3])
  lit=sample(255,255);blocked=sample(0,255);foreground=sample(255,128)
  assert lit>0 and blocked==0 and foreground<lit,(lit,blocked,foreground)
  print('Rendered light occlusion: lit',lit,'blocked',blocked,'foreground',foreground)
