import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import MemberDistributionDashboard from "@/components/member/MemberDistributionDashboard";

/**
 * Member dosing overview page.
 */
export default function MemberDosing() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1 py-12">
        <div className="container max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <MemberDistributionDashboard />
        </div>
      </main>
      <Footer />
    </div>
  );
}
