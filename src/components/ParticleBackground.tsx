import React, { useEffect, useRef } from 'react';
import { useTheme } from '@/context/ThemeProvider';

export const ParticleBackground: React.FC = () => {
    const { resolved } = useTheme();
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        if (resolved !== 'dark') return;

        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        let width: number, height: number, particles: Particle[], dpr: number;
        const PARTICLE_COUNT = 6000; 
        const MOUSE_RADIUS = 150;
        const PUSH_FORCE = 0.4;
        const RETURN_SPEED = 0.008;
        const FRICTION = 0.94;

        let mouse = { x: -9999, y: -9999 };
        let smoothMouse = { x: -9999, y: -9999 };
        let time = 0;
        let animationFrameId: number;

        class Particle {
            homeX: number;
            homeY: number;
            x: number;
            y: number;
            vx: number;
            vy: number;
            noiseOffsetX: number;
            noiseOffsetY: number;
            noiseSpeed: number;
            noiseAmplitude: number;
            flowSpeed: number;
            r: number;
            g: number;
            b: number;
            baseAlpha: number;
            alpha: number;
            size: number;
            pulse: number;
            pulseSpeed: number;
            depth: number;

            constructor() {
                this.homeX = Math.random() * width;
                this.homeY = Math.random() * height;
                this.x = this.homeX;
                this.y = this.homeY;
                this.vx = 0;
                this.vy = 0;

                this.noiseOffsetX = Math.random() * 1000;
                this.noiseOffsetY = Math.random() * 1000;
                this.noiseSpeed = 0.00008 + Math.random() * 0.00015;
                this.noiseAmplitude = 15 + Math.random() * 30;
                this.flowSpeed = 0.03 + Math.random() * 0.07;

                const blueVariant = Math.random();
                if (blueVariant < 0.25) {
                    this.r = 20 + Math.random() * 30;
                    this.g = 50 + Math.random() * 50;
                    this.b = 140 + Math.random() * 60;
                } else if (blueVariant < 0.5) {
                    this.r = 50 + Math.random() * 40;
                    this.g = 100 + Math.random() * 60;
                    this.b = 200 + Math.random() * 55;
                } else if (blueVariant < 0.75) {
                    this.r = 70 + Math.random() * 50;
                    this.g = 130 + Math.random() * 70;
                    this.b = 220 + Math.random() * 35;
                } else {
                    this.r = 140 + Math.random() * 60;
                    this.g = 180 + Math.random() * 50;
                    this.b = 230 + Math.random() * 25;
                }

                this.baseAlpha = 0.15 + Math.random() * 0.45;
                this.alpha = this.baseAlpha;
                this.size = 0.6 + Math.random() * 1.4;
                this.pulse = Math.random() * Math.PI * 2;
                this.pulseSpeed = 0.003 + Math.random() * 0.01;
                this.depth = Math.random();
                this.size *= (0.5 + this.depth * 0.8);
                this.baseAlpha *= (0.3 + this.depth * 0.7);
            }

            update(t: number) {
                const nx = Math.sin((this.homeX * 0.003) + t * this.noiseSpeed * 20 + this.noiseOffsetX) *
                           Math.cos((this.homeY * 0.002) + t * this.noiseSpeed * 14) * this.noiseAmplitude;
                const ny = Math.cos((this.homeY * 0.003) + t * this.noiseSpeed * 16 + this.noiseOffsetY) *
                           Math.sin((this.homeX * 0.002) + t * this.noiseSpeed * 12) * this.noiseAmplitude * 0.8;

                const drift = Math.sin(t * 0.00005 + this.homeY * 0.005) * this.flowSpeed;
                const targetX = this.homeX + nx + drift * 10;
                const targetY = this.homeY + ny;

                const dx = smoothMouse.x - this.x;
                const dy = smoothMouse.y - this.y;
                const dist = Math.sqrt(dx * dx + dy * dy);

                if (dist < MOUSE_RADIUS && dist > 0) {
                    const angle = Math.atan2(dy, dx);
                    const normalizedDist = dist / MOUSE_RADIUS;
                    const force = (1 - normalizedDist) * (1 - normalizedDist) * (1 - normalizedDist) * PUSH_FORCE;
                    this.vx -= Math.cos(angle) * force;
                    this.vy -= Math.sin(angle) * force;
                    this.alpha += (Math.min(1, this.baseAlpha + 0.1) - this.alpha) * 0.02;
                } else {
                    this.alpha += (this.baseAlpha - this.alpha) * 0.02;
                }

                this.vx += (targetX - this.x) * RETURN_SPEED;
                this.vy += (targetY - this.y) * RETURN_SPEED;
                this.vx *= FRICTION;
                this.vy *= FRICTION;
                this.x += this.vx;
                this.y += this.vy;
                this.pulse += this.pulseSpeed;
            }

            draw(ctx: CanvasRenderingContext2D) {
                const pulseFactor = 0.9 + 0.1 * Math.sin(this.pulse);
                const currentAlpha = this.alpha * pulseFactor;
                const currentSize = this.size * (0.95 + 0.05 * Math.sin(this.pulse));

                ctx.beginPath();
                ctx.arc(this.x, this.y, currentSize, 0, Math.PI * 2);
                ctx.fillStyle = `rgba(${this.r}, ${this.g}, ${this.b}, ${currentAlpha})`;
                ctx.fill();

                if (currentAlpha > 0.4 && this.depth > 0.7) {
                    ctx.beginPath();
                    ctx.arc(this.x, this.y, currentSize * 2.5, 0, Math.PI * 2);
                    ctx.fillStyle = `rgba(${this.r}, ${this.g}, ${this.b}, ${currentAlpha * 0.06})`;
                    ctx.fill();
                }
            }
        }

        const initParticles = () => {
            particles = [];
            for (let i = 0; i < PARTICLE_COUNT; i++) {
                particles.push(new Particle());
            }
        };

        const resize = () => {
            dpr = window.devicePixelRatio || 1;
            width = window.innerWidth;
            height = window.innerHeight;
            canvas.width = width * dpr;
            canvas.height = height * dpr;
            canvas.style.width = width + 'px';
            canvas.style.height = height + 'px';
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            initParticles();
        };

        const animate = () => {
            time++;
            const lerpFactor = 0.05;
            if (mouse.x > -9000) {
                smoothMouse.x += (mouse.x - smoothMouse.x) * lerpFactor;
                smoothMouse.y += (mouse.y - smoothMouse.y) * lerpFactor;
            } else {
                smoothMouse.x += (-9999 - smoothMouse.x) * lerpFactor;
                smoothMouse.y += (-9999 - smoothMouse.y) * lerpFactor;
            }

            ctx.clearRect(0, 0, width, height);

            const grad = ctx.createRadialGradient(width / 2, height / 2, 0, width / 2, height / 2, width * 0.8);
            grad.addColorStop(0, 'rgba(10, 20, 50, 0.15)');
            grad.addColorStop(0.5, 'rgba(5, 10, 30, 0.08)');
            grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, width, height);

            for (let i = 0; i < particles.length; i++) {
                particles[i].update(time);
                particles[i].draw(ctx);
            }

            animationFrameId = requestAnimationFrame(animate);
        };

        const handleMouseMove = (e: MouseEvent) => {
            mouse.x = e.clientX;
            mouse.y = e.clientY;
        };

        const handleMouseLeave = () => {
            mouse.x = -9999;
            mouse.y = -9999;
        };

        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseleave', handleMouseLeave);
        window.addEventListener('resize', resize);
        
        resize();
        animate();

        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseleave', handleMouseLeave);
            window.removeEventListener('resize', resize);
            cancelAnimationFrame(animationFrameId);
        };
    }, [resolved]);

    if (resolved !== 'dark') return null;

    return (
        <>
            <canvas
                ref={canvasRef}
                className="fixed top-0 left-0 w-full h-full pointer-events-none z-[-1]"
                style={{ background: '#000000' }}
            />
            <div 
                className="fixed inset-0 z-0 pointer-events-none opacity-[0.03]"
                style={{ 
                    backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E")`,
                    backgroundSize: '128px 128px'
                }}
            />
        </>
    );
};
