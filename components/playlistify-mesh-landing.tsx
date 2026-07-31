'use client'

import { useEffect, useRef } from 'react'

import { SpotifySignInButton } from '@/components/spotify-sign-in-button'

const VERTEX_SHADER_SOURCE = `
  attribute vec2 aPosition;
  varying vec2 vUv;

  void main() {
    vUv = aPosition * 0.5 + 0.5;
    gl_Position = vec4(aPosition, 0.0, 1.0);
  }
`

const FRAGMENT_SHADER_SOURCE = `
  precision highp float;

  varying vec2 vUv;
  uniform vec2 uResolution;
  uniform vec2 uWordBounds;
  uniform float uTime;
  uniform float uFlowSpeed;
  uniform float uCloudScale;
  uniform float uCloudGlow;
  uniform float uCenterPull;
  uniform float uRepelStrength;
  uniform float uWakeAmount;
  uniform vec3 uBaseColor;
  uniform vec3 uColor1;
  uniform vec3 uColor2;
  uniform vec3 uColor3;
  uniform vec3 uColor4;

  float hash21(vec2 point) {
    point = fract(point * vec2(123.34, 456.21));
    point += dot(point, point + 45.32);
    return fract(point.x * point.y);
  }

  float valueNoise(vec2 point) {
    vec2 cell = floor(point);
    vec2 local = fract(point);
    local = local * local * (3.0 - 2.0 * local);

    float a = hash21(cell);
    float b = hash21(cell + vec2(1.0, 0.0));
    float c = hash21(cell + vec2(0.0, 1.0));
    float d = hash21(cell + vec2(1.0, 1.0));

    return mix(mix(a, b, local.x), mix(c, d, local.x), local.y);
  }

  float fbm(vec2 point) {
    float total = 0.0;
    float amplitude = 0.52;
    mat2 turn = mat2(0.82, -0.57, 0.57, 0.82);

    for (int octave = 0; octave < 4; octave++) {
      total += amplitude * valueNoise(point);
      point = turn * point * 2.03 + vec2(7.1, 3.7);
      amplitude *= 0.5;
    }

    return total;
  }

  float capsuleSdf(vec2 point, vec2 halfSize) {
    float radius = halfSize.y;
    float segment = max(halfSize.x - radius, 0.0);
    vec2 nearest = vec2(clamp(point.x, -segment, segment), 0.0);
    return length(point - nearest) - radius;
  }

  void main() {
    vec2 uv = vUv;
    float aspect = uResolution.x / max(uResolution.y, 1.0);
    vec2 centered = uv - 0.5;
    centered.x *= aspect;

    float rise = uTime * uFlowSpeed;
    float heightMix = smoothstep(-0.55, 0.55, centered.y);
    centered.x *= mix(0.9, 1.0 + uCenterPull * 0.32, heightMix);

    float shieldDistance = capsuleSdf(centered, uWordBounds);
    float verticalReach = max(uWordBounds.y * 6.2, 0.15);
    float verticalInfluence =
      1.0 - smoothstep(uWordBounds.y, verticalReach, abs(centered.y));
    float horizontalInfluence =
      1.0 - smoothstep(
        uWordBounds.x * 0.58,
        uWordBounds.x + verticalReach * 0.92,
        abs(centered.x)
      );
    float splitNoise =
      fbm(vec2(centered.y * 3.8 - rise * 0.22, 4.7)) - 0.5;
    float splitSeed = centered.x + splitNoise * uWordBounds.y * 0.82;
    float horizontalBlend = max(uWordBounds.y * 1.7, 0.032);
    float verticalBlend = max(uWordBounds.y * 2.2, 0.044);
    float side =
      smoothstep(-horizontalBlend, horizontalBlend, splitSeed) * 2.0 - 1.0;
    float verticalSide =
      smoothstep(-verticalBlend, verticalBlend, centered.y) * 2.0 - 1.0;
    float shieldInfluence = verticalInfluence * horizontalInfluence;

    vec2 flow = centered;
    flow.x -=
      side * shieldInfluence * uWordBounds.y * uRepelStrength * uWakeAmount;
    flow.y -=
      verticalSide * shieldInfluence * uWordBounds.y * 0.16 * uWakeAmount;
    flow.y -= rise;
    flow.x += sin(flow.y * 1.35 + rise * 0.22) * 0.055;
    flow.x += sin(flow.y * 2.8 - rise * 0.13) * 0.022;

    vec2 broadWarp = vec2(
      fbm(flow * 0.72 + vec2(1.7, 4.1)),
      fbm(flow * 0.76 + vec2(7.3, 1.9))
    ) - 0.5;

    vec2 cloudPoint = flow * uCloudScale + broadWarp * 1.38;
    float macro = fbm(cloudPoint * 0.48 + vec2(2.2, 5.8));
    float body = fbm(cloudPoint + vec2(0.0, -rise * 0.28));
    float detail = fbm(
      cloudPoint * 1.72 -
      broadWarp * 0.66 +
      vec2(4.6, -rise * 0.38)
    );

    float connectedField = body * 0.62 + macro * 0.48;
    float density = smoothstep(0.3, 0.79, connectedField);
    density = pow(density, 0.78);

    float centerEnergy = exp(-abs(centered.x) * 0.84);
    density *= mix(0.68, 1.08, centerEnergy);
    density *= mix(0.78, 1.0, smoothstep(-0.58, 0.08, centered.y));

    float protectedLane = mix(
      1.0,
      smoothstep(-0.012, 0.032, shieldDistance),
      uWakeAmount
    );
    density *= mix(0.74, 1.0, protectedLane);

    vec2 shoulderScale = vec2(
      max(uWordBounds.y * 2.7, 0.055),
      max(uWordBounds.y * 4.2, 0.09)
    );
    float leftShoulder = length(
      (centered - vec2(-uWordBounds.x, 0.0)) / shoulderScale
    );
    float rightShoulder = length(
      (centered - vec2(uWordBounds.x, 0.0)) / shoulderScale
    );
    float wrapPressure =
      exp(-leftShoulder * 1.42) + exp(-rightShoulder * 1.42);
    wrapPressure *= density * (0.42 + detail * 0.58) * uWakeAmount;

    float foldedLight = detail * 0.68 + macro * 0.44;
    float internalGlow = smoothstep(0.43, 0.76, foldedLight);
    internalGlow = pow(internalGlow, 1.26) * density;

    float risingVein = fbm(
      vec2(
        cloudPoint.x * 0.58 + broadWarp.x,
        cloudPoint.y * 1.42 - rise * 0.55
      ) + vec2(8.1, 2.4)
    );
    float illuminatedCore = smoothstep(0.49, 0.74, risingVein);
    illuminatedCore *= density * centerEnergy;

    vec3 color = uBaseColor;
    color = mix(color, uColor1, density * 0.72);
    color = mix(
      color,
      uColor2,
      clamp(density * (0.36 + body * 0.58), 0.0, 0.82)
    );
    color += uColor3 * internalGlow * uCloudGlow * 0.84;
    color += uColor4 * illuminatedCore * uCloudGlow * 0.76;
    color += uColor3 * wrapPressure * uCloudGlow * 0.18;
    color += uColor4 * pow(wrapPressure, 1.28) * uCloudGlow * 0.12;

    float edgeDistance = length(
      vec2(centered.x / max(aspect, 1.0), centered.y * 0.82)
    );
    float vignette = 1.0 - smoothstep(0.36, 0.78, edgeDistance);
    color *= mix(0.34, 1.0, vignette);

    float grain = hash21(gl_FragCoord.xy + floor(uTime * 12.0));
    color += (grain - 0.5) * 0.012;
    color = color / (color + vec3(0.76));
    color = pow(color, vec3(0.92));

    gl_FragColor = vec4(color, 1.0);
  }
`

type MeshLandingMode = 'veil' | 'wake'

type PlaylistifyMeshLandingProps = {
  mode: MeshLandingMode
}

type MeshTuning = {
  baseColor: Float32Array<ArrayBuffer>
  cloudGlow: number
  cloudScale: number
  color1: Float32Array<ArrayBuffer>
  color2: Float32Array<ArrayBuffer>
  color3: Float32Array<ArrayBuffer>
  color4: Float32Array<ArrayBuffer>
  centerPull: number
  flowSpeed: number
  repelStrength: number
  wordmarkClearance: number
}

const hexToVector = (hex: string) => {
  const value = hex.replace('#', '')
  return new Float32Array([
    Number.parseInt(value.slice(0, 2), 16) / 255,
    Number.parseInt(value.slice(2, 4), 16) / 255,
    Number.parseInt(value.slice(4, 6), 16) / 255,
  ])
}

const readTuning = (root: HTMLElement): MeshTuning => {
  const styles = getComputedStyle(root)
  const readNumber = (name: string) =>
    Number.parseFloat(styles.getPropertyValue(name))

  return {
    baseColor: hexToVector(styles.getPropertyValue('--mesh-base').trim()),
    cloudGlow: readNumber('--mesh-cloud-glow'),
    cloudScale: readNumber('--mesh-cloud-scale'),
    color1: hexToVector(styles.getPropertyValue('--mesh-color-1').trim()),
    color2: hexToVector(styles.getPropertyValue('--mesh-color-2').trim()),
    color3: hexToVector(styles.getPropertyValue('--mesh-color-3').trim()),
    color4: hexToVector(styles.getPropertyValue('--mesh-color-4').trim()),
    centerPull: readNumber('--mesh-center-pull'),
    flowSpeed: readNumber('--mesh-flow-speed'),
    repelStrength: readNumber('--mesh-repel-strength'),
    wordmarkClearance: readNumber('--mesh-wordmark-clearance'),
  }
}

const createShader = (
  gl: WebGLRenderingContext,
  type: number,
  source: string,
) => {
  const shader = gl.createShader(type)
  if (!shader) return null

  gl.shaderSource(shader, source)
  gl.compileShader(shader)

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error(gl.getShaderInfoLog(shader))
    gl.deleteShader(shader)
    return null
  }

  return shader
}

export const PlaylistifyMeshLanding = ({
  mode,
}: PlaylistifyMeshLandingProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rootRef = useRef<HTMLElement>(null)
  const wordmarkRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const root = rootRef.current
    const wordmark = wordmarkRef.current
    if (!canvas || !root || !wordmark) return
    const tuning = readTuning(root)

    const gl = canvas.getContext('webgl', {
      alpha: false,
      antialias: false,
      depth: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false,
    })
    if (!gl) return

    const vertexShader = createShader(
      gl,
      gl.VERTEX_SHADER,
      VERTEX_SHADER_SOURCE,
    )
    const fragmentShader = createShader(
      gl,
      gl.FRAGMENT_SHADER,
      FRAGMENT_SHADER_SOURCE,
    )
    if (!vertexShader || !fragmentShader) return

    const program = gl.createProgram()

    gl.attachShader(program, vertexShader)
    gl.attachShader(program, fragmentShader)
    gl.linkProgram(program)

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error(gl.getProgramInfoLog(program))
      gl.deleteProgram(program)
      return
    }

    const positionBuffer = gl.createBuffer()

    gl.useProgram(program)
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer)
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 3, -1, -1, 3]),
      gl.STATIC_DRAW,
    )

    const positionLocation = gl.getAttribLocation(program, 'aPosition')
    if (positionLocation < 0) {
      gl.deleteBuffer(positionBuffer)
      gl.deleteProgram(program)
      return
    }

    gl.enableVertexAttribArray(positionLocation)
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0)

    const uniforms = {
      baseColor: gl.getUniformLocation(program, 'uBaseColor'),
      centerPull: gl.getUniformLocation(program, 'uCenterPull'),
      cloudGlow: gl.getUniformLocation(program, 'uCloudGlow'),
      cloudScale: gl.getUniformLocation(program, 'uCloudScale'),
      color1: gl.getUniformLocation(program, 'uColor1'),
      color2: gl.getUniformLocation(program, 'uColor2'),
      color3: gl.getUniformLocation(program, 'uColor3'),
      color4: gl.getUniformLocation(program, 'uColor4'),
      flowSpeed: gl.getUniformLocation(program, 'uFlowSpeed'),
      repelStrength: gl.getUniformLocation(program, 'uRepelStrength'),
      resolution: gl.getUniformLocation(program, 'uResolution'),
      time: gl.getUniformLocation(program, 'uTime'),
      wakeAmount: gl.getUniformLocation(program, 'uWakeAmount'),
      wordBounds: gl.getUniformLocation(program, 'uWordBounds'),
    }

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    const frameInterval = 1000 / 30
    const renderScale = 0.58
    const maxDeviceScale = 1.15
    const wordBounds = new Float32Array([0.14, 0.05])
    let animationFrame = 0
    let canvasRevealFrame = 0
    let canvasWarmupFrames = 0
    let isCanvasReady = false
    let lastFrameAt = Number.NEGATIVE_INFINITY

    const resize = () => {
      const bounds = root.getBoundingClientRect()
      const wordmarkBounds = wordmark.getBoundingClientRect()
      const safeHeight = Math.max(bounds.height, 1)
      const clearance = Number.isFinite(tuning.wordmarkClearance)
        ? tuning.wordmarkClearance
        : 14

      wordBounds[0] =
        wordmarkBounds.width / (safeHeight * 2) + clearance / safeHeight
      wordBounds[1] =
        wordmarkBounds.height / (safeHeight * 2) +
        (clearance * 0.78) / safeHeight

      const pixelScale =
        Math.min(window.devicePixelRatio || 1, maxDeviceScale) * renderScale
      const nextWidth = Math.max(1, Math.round(bounds.width * pixelScale))
      const nextHeight = Math.max(1, Math.round(bounds.height * pixelScale))

      if (canvas.width === nextWidth && canvas.height === nextHeight) return

      if (isCanvasReady) {
        isCanvasReady = false
        delete root.dataset.canvasReady
      }

      canvasWarmupFrames = 0
      canvas.width = nextWidth
      canvas.height = nextHeight
      gl.viewport(0, 0, nextWidth, nextHeight)
    }

    const draw = (time: number) => {
      gl.uniform2f(uniforms.resolution, canvas.width, canvas.height)
      gl.uniform2fv(uniforms.wordBounds, wordBounds)
      gl.uniform1f(uniforms.time, time / 1000)
      gl.uniform1f(uniforms.flowSpeed, tuning.flowSpeed)
      gl.uniform1f(uniforms.cloudScale, tuning.cloudScale)
      gl.uniform1f(uniforms.cloudGlow, tuning.cloudGlow)
      gl.uniform1f(uniforms.centerPull, tuning.centerPull)
      gl.uniform1f(uniforms.repelStrength, tuning.repelStrength)
      gl.uniform1f(uniforms.wakeAmount, mode === 'wake' ? 1 : 0)
      gl.uniform3fv(uniforms.baseColor, tuning.baseColor)
      gl.uniform3fv(uniforms.color1, tuning.color1)
      gl.uniform3fv(uniforms.color2, tuning.color2)
      gl.uniform3fv(uniforms.color3, tuning.color3)
      gl.uniform3fv(uniforms.color4, tuning.color4)
      gl.drawArrays(gl.TRIANGLES, 0, 3)

      if (!isCanvasReady) {
        gl.finish()
        canvasWarmupFrames += 1
        const requiredWarmupFrames = reducedMotion.matches ? 1 : 2
        if (canvasWarmupFrames < requiredWarmupFrames) return

        isCanvasReady = true
        cancelAnimationFrame(canvasRevealFrame)
        canvasRevealFrame = requestAnimationFrame(() => {
          root.dataset.canvasReady = 'true'
        })
      }
    }

    const animate = (time: number) => {
      if (time - lastFrameAt >= frameInterval) {
        lastFrameAt = time
        draw(reducedMotion.matches ? 5400 : time)
      }

      if (!reducedMotion.matches) {
        animationFrame = requestAnimationFrame(animate)
      }
    }

    const restartAnimation = () => {
      cancelAnimationFrame(animationFrame)

      if (reducedMotion.matches) {
        draw(5400)
      } else {
        animationFrame = requestAnimationFrame(animate)
      }
    }

    resize()
    restartAnimation()

    const resizeObserver = new ResizeObserver(resize)
    resizeObserver.observe(root)
    resizeObserver.observe(wordmark)
    reducedMotion.addEventListener('change', restartAnimation)

    return () => {
      cancelAnimationFrame(animationFrame)
      cancelAnimationFrame(canvasRevealFrame)
      reducedMotion.removeEventListener('change', restartAnimation)
      resizeObserver.disconnect()
      delete root.dataset.canvasReady
      gl.deleteBuffer(positionBuffer)
      gl.deleteProgram(program)
      gl.deleteShader(fragmentShader)
      gl.deleteShader(vertexShader)
    }
  }, [mode])

  const description =
    mode === 'wake'
      ? 'A green light field bends around the Playlistify wordmark.'
      : 'A green light field passes through parts of the Playlistify wordmark.'

  return (
    <section
      ref={rootRef}
      aria-describedby='playlistify-mesh-description'
      aria-labelledby='playlistify-wordmark'
      className='mesh-landing'
      data-mode={mode}
    >
      <canvas ref={canvasRef} aria-hidden className='mesh-landing-canvas' />
      <div aria-hidden className='mesh-landing-depth' />
      <div aria-hidden className='mesh-landing-grain' />

      <h1
        ref={wordmarkRef}
        className='mesh-landing-wordmark'
        id='playlistify-wordmark'
      >
        PLAYLISTIFY
      </h1>

      <div className='mesh-landing-cta'>
        <SpotifySignInButton className='h-12 rounded-full border-white/20 bg-[#f1f5eb] px-6 text-[#10170f] shadow-[0_1rem_3rem_rgba(0,0,0,0.3)] hover:bg-white focus-visible:border-white/70 focus-visible:ring-white/30' />
      </div>

      <p className='sr-only' id='playlistify-mesh-description'>
        {description} Continue with Spotify to import your Liked Songs and
        create playlists from a sentence.
      </p>
    </section>
  )
}
