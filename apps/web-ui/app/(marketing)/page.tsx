import { Navbar } from './components/navbar';
import { Hero } from './components/hero';
import { SocialProof } from './components/social-proof';
import { FeatureShowcase } from './components/feature-showcase';
import { FeatureGrid } from './components/feature-grid';
import { QuickStart } from './components/quick-start';
import { Pricing } from './components/pricing';
import { CTASection } from './components/cta-section';
import { Footer } from './components/footer';

export default function MarketingPage() {
  return (
    <>
      <Navbar />
      <Hero />
      <SocialProof />
      <FeatureShowcase />
      <FeatureGrid />
      <QuickStart />
      <Pricing />
      <CTASection />
      <Footer />
    </>
  );
}
