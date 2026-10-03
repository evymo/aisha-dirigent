import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { ENROLLMENT_STEPS } from "./types";

interface RegistrationProgressProps {
  currentStep: number;
}

export function RegistrationProgress({ currentStep }: RegistrationProgressProps) {

  return (
    <div className="flex justify-between mb-8">
      {ENROLLMENT_STEPS.map((step, index) => (
        <div key={step.id} className="flex items-center">
          <div
            className={cn(
              "w-10 h-10 rounded-full flex items-center justify-center text-sm font-medium",
              currentStep > step.id
                ? "bg-secondary text-secondary-foreground"
                : currentStep === step.id
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground"
            )}
          >
            {currentStep > step.id ? <Check className="w-5 h-5" /> : step.id}
          </div>
          {index < ENROLLMENT_STEPS.length - 1 && (
            <div
              className={cn(
                "hidden md:block w-16 h-1 mx-2",
                currentStep > step.id ? "bg-secondary" : "bg-muted"
              )}
            />
          )}
        </div>
      ))}
    </div>
  );
}
