import { cn } from "@/lib/utils";

interface VideoBackgroundProps {
  src?: string;
  fallbackImage?: string;
  overlay?: "light" | "dark" | "none";
  className?: string;
  children?: React.ReactNode;
}

export function VideoBackground({ 
  src = "https://videos.pexels.com/video-files/4505564/4505564-uhd_2732_1440_25fps.mp4",
  fallbackImage,
  overlay = "light",
  className,
  children 
}: VideoBackgroundProps) {
  return (
    <div className={cn("relative overflow-hidden", className)}>
      {/* Video */}
      <div className="video-bg-container">
        <video
          autoPlay
          loop
          muted
          playsInline
          className="video-bg"
          poster={fallbackImage}
        >
          <source src={src} type="video/mp4" />
        </video>
        
        {/* Overlay */}
        {overlay !== "none" && (
          <div className={overlay === "dark" ? "video-overlay-dark" : "video-overlay"} />
        )}
      </div>
      
      {/* Content */}
      <div className="relative z-10">
        {children}
      </div>
    </div>
  );
}
