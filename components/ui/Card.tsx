interface CardProps {
  children: React.ReactNode;
  className?: string;
}

export default function Card({ children, className = "" }: CardProps) {
  return (
    <div
      className={`relative bg-white/80 backdrop-blur-xl border border-slate-200 rounded-2xl shadow-2xl shadow-slate-200/50 p-8 ${className}`}
    >
      {children}
    </div>
  );
}
