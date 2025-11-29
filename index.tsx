import React, { useState, useEffect, useContext, createContext, useRef } from "react";
import { createRoot } from "react-dom/client";
import { motion, AnimatePresence } from "framer-motion";

// ==========================================
// ⚙️ CONFIGURATION (FILL THESE IN)
// ==========================================
const WORKER_URL = "https://damp-wind-775f.rusdumitru122.workers.dev/"; // Your Cloudflare Worker
const SUPABASE_URL = "YOUR_SUPABASE_URL_HERE"; 
const SUPABASE_KEY = "YOUR_SUPABASE_ANON_KEY_HERE";

// TypeScript Hack for CDN Supabase
declare global {
    interface Window { supabase: any; }
}

// Initialize Supabase Client
const supabase = window.supabase ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY) : null;

// ==========================================
// 🛠️ UTILS
// ==========================================

const scrollToSection = (e: React.MouseEvent, id: string) => {
  e.preventDefault();
  const element = document.getElementById(id);
  if (element) {
    element.scrollIntoView({ behavior: "smooth" });
  }
};

// ==========================================
// 🔐 AUTH CONTEXT (REAL SUPABASE)
// ==========================================

type User = {
    email: string;
    id?: string;
};

interface AuthContextType {
    user: User | null;
    isLoading: boolean;
    login: (e: string, p: string) => Promise<any>;
    signup: (e: string, p: string) => Promise<any>;
    logout: () => void;
    showAuthModal: boolean;
    setShowAuthModal: (show: boolean) => void;
    authView: 'login' | 'signup';
    setAuthView: (view: 'login' | 'signup') => void;
    openTool: () => void; // Shortcut to open the tool directly
}

const AuthContext = createContext<AuthContextType>({} as AuthContextType);

const AuthProvider = ({ children }: { children: React.ReactNode }) => {
    const [user, setUser] = useState<User | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [showAuthModal, setShowAuthModal] = useState(false);
    const [showToolModal, setShowToolModal] = useState(false); // New state for the tool
    const [authView, setAuthView] = useState<'login' | 'signup'>('signup');

    useEffect(() => {
        // Check active session on load
        const checkSession = async () => {
            if(!supabase) return;
            const { data: { session } } = await supabase.auth.getSession();
            if (session?.user) {
                setUser({ email: session.user.email!, id: session.user.id });
            }
            setIsLoading(false);
        };
        checkSession();

        // Listen for auth changes
        const { data: { subscription } } = supabase?.auth.onAuthStateChange((_event: any, session: any) => {
            if (session?.user) {
                setUser({ email: session.user.email!, id: session.user.id });
            } else {
                setUser(null);
            }
        }) || { data: { subscription: null } };

        return () => subscription?.unsubscribe();
    }, []);

    const login = async (email: string, password: string) => {
        if(!supabase) return { error: { message: "Supabase not configured" } };
        const result = await supabase.auth.signInWithPassword({ email, password });
        if (!result.error) setShowAuthModal(false);
        return result;
    };

    const signup = async (email: string, password: string) => {
        if(!supabase) return { error: { message: "Supabase not configured" } };
        const result = await supabase.auth.signUp({ email, password });
        if (!result.error) setShowAuthModal(false);
        return result;
    };

    const logout = async () => {
        if(supabase) await supabase.auth.signOut();
        setUser(null);
    };

    const openTool = () => {
        setShowToolModal(true);
    };

    return (
        <AuthContext.Provider value={{ 
            user, isLoading, login, signup, logout,
            showAuthModal, setShowAuthModal,
            authView, setAuthView, openTool
        }}>
            {children}
            {/* Render the Floating Tool Modal here so it can access context */}
            <ViralAuditTool isOpen={showToolModal} onClose={() => setShowToolModal(false)} />
        </AuthContext.Provider>
    );
};

const useAuth = () => useContext(AuthContext);

// ==========================================
// 🚀 THE APP COMPONENT (VIDEO ANALYZER)
// ==========================================

const ViralAuditTool = ({ isOpen, onClose }: { isOpen: boolean, onClose: () => void }) => {
    const { user, setShowAuthModal, setAuthView } = useAuth();
    const [file, setFile] = useState<File | null>(null);
    const [analyzing, setAnalyzing] = useState(false);
    const [result, setResult] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    // Reset state when closed
    useEffect(() => { if(!isOpen) { setFile(null); setResult(null); setError(null); } }, [isOpen]);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            setFile(e.target.files[0]);
            setError(null);
        }
    };

    const runAnalysis = async () => {
        if (!file || !user) return;
        setAnalyzing(true);
        setError(null);

        try {
            // 1. Convert to Base64
            const toBase64 = (f: File) => new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.readAsDataURL(f);
                reader.onload = () => resolve((reader.result as string).split(',')[1]);
                reader.onerror = error => reject(error);
            });

            const base64Data = await toBase64(file);

            // 2. Send to Cloudflare Worker
            const response = await fetch(WORKER_URL, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    base64Data: base64Data,
                    mimeType: file.type,
                    licenseKey: user.email, // Use email as key
                    systemPrompt: "" // Use default
                })
            });

            const json = await response.json();

            if (json.error) throw new Error(json.error.message || "Analysis failed");
            if (!json.candidates?.[0]?.content?.parts?.[0]?.text) throw new Error("No analysis returned");

            setResult(json.candidates[0].content.parts[0].text);

        } catch (err: any) {
            setError(err.message);
        } finally {
            setAnalyzing(false);
        }
    };

    // Helper to format Markdown
    const formatText = (text: string) => {
        return text
            .replace(/\*\*(.*?)\*\*/g, '<strong class="text-white">$1</strong>')
            .replace(/#HOOK/g, '<h3 class="text-[#00F2EA] border-b border-[#333] pb-1 mt-6 mb-2 text-lg font-bold">🪝 HOOK</h3>')
            .replace(/#BODY/g, '<h3 class="text-[#00F2EA] border-b border-[#333] pb-1 mt-6 mb-2 text-lg font-bold">📹 BODY</h3>')
            .replace(/#AUDIO/g, '<h3 class="text-[#00F2EA] border-b border-[#333] pb-1 mt-6 mb-2 text-lg font-bold">🔊 AUDIO</h3>')
            .replace(/#SCRIPT/g, '<h3 class="text-[#00F2EA] border-b border-[#333] pb-1 mt-6 mb-2 text-lg font-bold">📝 SCRIPT</h3>')
            .replace(/\n/g, '<br>');
    };

    return (
        <AnimatePresence>
            {isOpen && (
                <>
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} className="fixed inset-0 bg-black/80 backdrop-blur-md z-[150]" />
                    <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }} className="fixed inset-0 z-[151] flex items-center justify-center p-4 pointer-events-none">
                        <div className="bg-[#111] border border-[#333] w-full max-w-2xl max-h-[90vh] rounded-2xl shadow-2xl overflow-hidden flex flex-col pointer-events-auto">
                            
                            {/* Header */}
                            <div className="p-5 border-b border-[#222] flex justify-between items-center bg-[#161616]">
                                <h2 className="text-xl font-bold flex items-center gap-2">
                                    <span className="bg-gradient-to-r from-[#FF0050] to-[#00F2EA] bg-clip-text text-transparent">ViralAudit AI</span>
                                </h2>
                                <button onClick={onClose} className="text-gray-500 hover:text-white"><i className="fa-solid fa-xmark text-xl"></i></button>
                            </div>

                            {/* Body */}
                            <div className="p-6 overflow-y-auto flex-1 custom-scrollbar">
                                {!user ? (
                                    <div className="text-center py-10">
                                        <div className="w-16 h-16 rounded-full bg-[#1a1a1a] flex items-center justify-center border border-[#333] mb-4 mx-auto">
                                            <i className="fa-solid fa-lock text-2xl text-[#FF0050]"></i>
                                        </div>
                                        <h3 className="text-xl font-bold text-white mb-2">Login Required</h3>
                                        <p className="text-gray-400 mb-6">You must be logged in to use the Deep Audit tool.</p>
                                        <button onClick={() => { onClose(); setShowAuthModal(true); setAuthView('login'); }} className="bg-white text-black font-bold px-6 py-3 rounded-lg hover:bg-gray-200">Log In / Sign Up</button>
                                    </div>
                                ) : !result ? (
                                    <div className="text-center">
                                        <div 
                                            onClick={() => document.getElementById('app-file-upload')?.click()}
                                            className={`border-2 border-dashed rounded-xl p-10 cursor-pointer transition-all ${file ? 'border-[#00F2EA] bg-[#00F2EA]/5' : 'border-[#333] hover:border-gray-500 hover:bg-[#1a1a1a]'}`}
                                        >
                                            <input type="file" id="app-file-upload" className="hidden" accept="video/mp4,video/quicktime,video/webm" onChange={handleFileChange} />
                                            <i className={`fa-solid ${file ? 'fa-check-circle text-[#00F2EA]' : 'fa-cloud-arrow-up text-gray-500'} text-4xl mb-4`}></i>
                                            <h4 className="text-white font-medium text-lg">{file ? file.name : "Upload Video Ad"}</h4>
                                            <p className="text-sm text-gray-500 mt-2">{file ? "Ready to analyze" : "MP4, MOV or WEBM (Max 20MB)"}</p>
                                        </div>

                                        {error && <p className="text-[#FF0050] text-sm mt-4 bg-[#FF0050]/10 p-3 rounded">{error}</p>}

                                        <button 
                                            onClick={runAnalysis} 
                                            disabled={!file || analyzing}
                                            className="w-full mt-6 bg-gradient-to-r from-[#FF0050] to-[#00F2EA] text-white font-bold py-4 rounded-xl disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                                        >
                                            {analyzing ? <><i className="fa-solid fa-circle-notch fa-spin"></i> Analyzing... (This takes ~30s)</> : "Run Deep Audit"}
                                        </button>
                                    </div>
                                ) : (
                                    // RESULTS VIEW
                                    <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4">
                                        <div className="flex items-center justify-between mb-4">
                                            <h3 className="text-white font-bold text-lg">Analysis Report</h3>
                                            <button onClick={() => setResult(null)} className="text-xs text-gray-500 hover:text-white underline">Audit Another</button>
                                        </div>
                                        <div 
                                            className="prose prose-invert max-w-none text-sm text-gray-300 leading-relaxed"
                                            dangerouslySetInnerHTML={{ __html: formatText(result) }}
                                        />
                                    </div>
                                )}
                            </div>
                        </div>
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    );
}

// ==========================================
// 🧩 COMPONENTS
// ==========================================

const AuthModal = () => {
    const { showAuthModal, setShowAuthModal, login, signup, authView, setAuthView } = useAuth();
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");

    if (!showAuthModal) return null;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError("");
        
        let res;
        if (authView === 'login') {
            res = await login(email, password);
        } else {
            res = await signup(email, password);
        }

        if (res.error) {
            setError(res.error.message);
        }
        
        setLoading(false);
    };

    return (
        <AnimatePresence>
            {showAuthModal && (
                <>
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowAuthModal(false)} className="fixed inset-0 bg-black/90 backdrop-blur-sm z-[200] cursor-pointer" />
                    <div className="fixed inset-0 z-[201] flex items-center justify-center pointer-events-none p-4">
                        <motion.div initial={{ scale: 0.95, opacity: 0, y: 20 }} animate={{ scale: 1, opacity: 1, y: 0 }} exit={{ scale: 0.95, opacity: 0, y: 20 }} className="bg-[#111] w-full max-w-md rounded-2xl border border-white/10 shadow-2xl pointer-events-auto overflow-hidden">
                            <div className="p-6 border-b border-white/5 flex justify-between items-center bg-[#151515]">
                                <h3 className="font-heading font-bold text-xl">{authView === 'login' ? 'Welcome Back' : 'Create Account'}</h3>
                                <button onClick={() => setShowAuthModal(false)} className="text-gray-500 hover:text-white transition-colors"><i className="fa-solid fa-xmark text-lg"></i></button>
                            </div>
                            <div className="p-8">
                                <form onSubmit={handleSubmit} className="space-y-4">
                                    <div>
                                        <label className="block text-xs font-mono text-gray-500 uppercase mb-2">Email Address</label>
                                        <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="w-full bg-[#0a0a0a] border border-white/10 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-white/30 transition-colors" placeholder="name@company.com" />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-mono text-gray-500 uppercase mb-2">Password</label>
                                        <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} className="w-full bg-[#0a0a0a] border border-white/10 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-white/30 transition-colors" placeholder="••••••••" />
                                    </div>
                                    {error && <p className="text-[#FF0050] text-sm">{error}</p>}
                                    <button type="submit" disabled={loading} className="w-full bg-white text-black font-bold py-3.5 rounded-lg hover:bg-gray-200 transition-all mt-4 flex items-center justify-center gap-2">
                                        {loading ? <i className="fa-solid fa-circle-notch fa-spin"></i> : (authView === 'login' ? 'Sign In' : 'Create Free Account')}
                                    </button>
                                </form>
                                <div className="mt-6 text-center text-sm text-gray-500">
                                    {authView === 'login' ? <>Don't have an account? <button onClick={() => setAuthView('signup')} className="text-white hover:underline font-medium">Sign up</button></> : <>Already have an account? <button onClick={() => setAuthView('login')} className="text-white hover:underline font-medium">Sign in</button></>}
                                </div>
                            </div>
                        </motion.div>
                    </div>
                </>
            )}
        </AnimatePresence>
    );
};

const Navbar = () => {
  const [scrolled, setScrolled] = useState(false);
  const { user, logout, setShowAuthModal, setAuthView } = useAuth();

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <nav className={`fixed w-full z-50 transition-all duration-300 ${scrolled ? "bg-black/80 backdrop-blur-xl border-b border-white/10 py-3" : "bg-transparent py-6"}`}>
      <div className="max-w-7xl mx-auto px-6 flex items-center justify-between h-10">
        <a href="#" className="flex items-center gap-2 z-10 group" onClick={(e) => { e.preventDefault(); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>
            <div className="w-8 h-8 bg-white rounded-lg flex items-center justify-center group-hover:scale-110 transition-transform"><i className="fa-solid fa-bolt text-black text-sm"></i></div>
            <span className="font-heading font-bold text-xl tracking-tight text-white group-hover:text-gray-200 transition-colors">ViralAudit</span>
        </a>
        <div className="hidden md:flex absolute left-1/2 -translate-x-1/2 gap-8 text-sm font-medium text-gray-400">
          <a href="#features" onClick={(e) => scrollToSection(e, "features")} className="hover:text-white transition-colors">Features</a>
          <a href="#pricing" onClick={(e) => scrollToSection(e, "pricing")} className="hover:text-white transition-colors">Pricing</a>
        </div>
        <div className="z-10 flex items-center gap-4">
          {user ? (
             <>
                 <span className="text-xs text-gray-400 hidden sm:block">{user.email}</span>
                 <button onClick={logout} className="text-sm font-medium text-white hover:text-gray-300 transition-colors">Logout</button>
             </>
          ) : (
             <>
                <button onClick={() => { setAuthView('login'); setShowAuthModal(true); }} className="text-sm font-medium text-gray-300 hover:text-white transition-colors hidden sm:block">Login</button>
                <button onClick={() => { setAuthView('signup'); setShowAuthModal(true); }} className="bg-white text-black px-6 py-2.5 rounded-lg font-bold text-sm hover:bg-gray-200 transition-all shadow-lg">Get Started</button>
             </>
          )}
        </div>
      </div>
    </nav>
  );
};

const Background = () => {
    return (
        <div className="fixed inset-0 z-0 pointer-events-none">
            <div className="absolute inset-0 opacity-[0.03]" style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 20