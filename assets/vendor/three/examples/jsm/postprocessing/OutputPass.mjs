/* esm.sh - three@0.170.0/examples/jsm/postprocessing/OutputPass */
import{ColorManagement as m,RawShaderMaterial as d,UniformsUtils as c,LinearToneMapping as M,ReinhardToneMapping as N,CineonToneMapping as C,AgXToneMapping as T,ACESFilmicToneMapping as E,NeutralToneMapping as A,SRGBTransfer as S}from"../../../three.mjs";import{BufferGeometry as g,Float32BufferAttribute as o,OrthographicCamera as f,Mesh as u}from"../../../three.mjs";var i=class{constructor(){this.isPass=!0,this.enabled=!0,this.needsSwap=!0,this.clear=!1,this.renderToScreen=!1}setSize(){}render(){console.error("THREE.Pass: .render() must be implemented in derived pass.")}dispose(){}},h=new f(-1,1,1,-1,0,1),r=class extends g{constructor(){super(),this.setAttribute("position",new o([-1,3,0,-1,-1,0,3,-1,0],3)),this.setAttribute("uv",new o([0,2,0,0,2,0],2))}},_=new r,t=class{constructor(e){this._mesh=new u(_,e)}dispose(){this._mesh.geometry.dispose()}render(e){e.render(this._mesh,h)}get material(){return this._mesh.material}set material(e){this._mesh.material=e}};var s={name:"OutputShader",uniforms:{tDiffuse:{value:null},toneMappingExposure:{value:1}},vertexShader:`
		precision highp float;

		uniform mat4 modelViewMatrix;
		uniform mat4 projectionMatrix;

		attribute vec3 position;
		attribute vec2 uv;

		varying vec2 vUv;

		void main() {

			vUv = uv;
			gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );

		}`,fragmentShader:`
	
		precision highp float;

		uniform sampler2D tDiffuse;

		#include <tonemapping_pars_fragment>
		#include <colorspace_pars_fragment>

		varying vec2 vUv;

		void main() {

			gl_FragColor = texture2D( tDiffuse, vUv );

			// tone mapping

			#ifdef LINEAR_TONE_MAPPING

				gl_FragColor.rgb = LinearToneMapping( gl_FragColor.rgb );

			#elif defined( REINHARD_TONE_MAPPING )

				gl_FragColor.rgb = ReinhardToneMapping( gl_FragColor.rgb );

			#elif defined( CINEON_TONE_MAPPING )

				gl_FragColor.rgb = CineonToneMapping( gl_FragColor.rgb );

			#elif defined( ACES_FILMIC_TONE_MAPPING )

				gl_FragColor.rgb = ACESFilmicToneMapping( gl_FragColor.rgb );

			#elif defined( AGX_TONE_MAPPING )

				gl_FragColor.rgb = AgXToneMapping( gl_FragColor.rgb );

			#elif defined( NEUTRAL_TONE_MAPPING )

				gl_FragColor.rgb = NeutralToneMapping( gl_FragColor.rgb );

			#endif

			// color space

			#ifdef SRGB_TRANSFER

				gl_FragColor = sRGBTransferOETF( gl_FragColor );

			#endif

		}`};var n=class extends i{constructor(){super();let e=s;this.uniforms=c.clone(e.uniforms),this.material=new d({name:e.name,uniforms:this.uniforms,vertexShader:e.vertexShader,fragmentShader:e.fragmentShader}),this.fsQuad=new t(this.material),this._outputColorSpace=null,this._toneMapping=null}render(e,l,p){this.uniforms.tDiffuse.value=p.texture,this.uniforms.toneMappingExposure.value=e.toneMappingExposure,(this._outputColorSpace!==e.outputColorSpace||this._toneMapping!==e.toneMapping)&&(this._outputColorSpace=e.outputColorSpace,this._toneMapping=e.toneMapping,this.material.defines={},m.getTransfer(this._outputColorSpace)===S&&(this.material.defines.SRGB_TRANSFER=""),this._toneMapping===M?this.material.defines.LINEAR_TONE_MAPPING="":this._toneMapping===N?this.material.defines.REINHARD_TONE_MAPPING="":this._toneMapping===C?this.material.defines.CINEON_TONE_MAPPING="":this._toneMapping===E?this.material.defines.ACES_FILMIC_TONE_MAPPING="":this._toneMapping===T?this.material.defines.AGX_TONE_MAPPING="":this._toneMapping===A&&(this.material.defines.NEUTRAL_TONE_MAPPING=""),this.material.needsUpdate=!0),this.renderToScreen===!0?(e.setRenderTarget(null),this.fsQuad.render(e)):(e.setRenderTarget(l),this.clear&&e.clear(e.autoClearColor,e.autoClearDepth,e.autoClearStencil),this.fsQuad.render(e))}dispose(){this.material.dispose(),this.fsQuad.dispose()}};export{n as OutputPass};
//# sourceMappingURL=OutputPass.mjs.map