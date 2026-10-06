export function Avatar({ className = "" }: { className?: string }) {
  return (
    <div
      className={`rounded-full bg-[radial-gradient(circle_at_30%_20%,#f7d5c8_20%,#a46e58_70%,#4f352b)] ${className}`}
    />
  );
}

export function NailStrip() {
  return (
    <div className="flex gap-2">
      {["#d7b1a1", "#b78476", "#4f6da8", "#d26388"].map((color) => (
        <div key={color} className="h-14 w-14 rounded-lg" style={{ backgroundColor: color }} />
      ))}
    </div>
  );
}