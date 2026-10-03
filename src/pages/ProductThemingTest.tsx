
import { useState } from 'react';
import { ProductThemeScope, ProductTheme } from '@/components/ui/product-theme-scope';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Slider } from '@/components/ui/slider';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

export default function ProductThemingTest() {
    const [activeProduct, setActiveProduct] = useState<ProductTheme>('floristen');
    const [sliderValue, setSliderValue] = useState([50]);

    return (
        <div className="min-h-screen bg-background text-foreground p-8 space-y-8">

            <div className="max-w-4xl mx-auto space-y-8">
                <header className="space-y-4 text-center">
                    <h1 className="text-4xl font-serif">Dynamic Product Atmospheres</h1>
                    <p className="text-muted-foreground">
                        Select a product below to switch the entire UI context (Colors, Glows, Glass attributes).
                    </p>

                    <div className="flex justify-center gap-4 p-4 bg-secondary/20 rounded-full w-fit mx-auto backdrop-blur-sm border border-border">
                        {(['floristen', 'lyastin', 'silexil', 'retisin'] as ProductTheme[]).map((p) => (
                            <button
                                key={p}
                                onClick={() => setActiveProduct(p)}
                                className={`
                  px-6 py-2 rounded-full capitalize transition-all duration-300 font-medium
                  ${activeProduct === p
                                        ? 'bg-primary text-primary-foreground shadow-lg scale-105'
                                        : 'hover:bg-muted text-muted-foreground'}
                `}
                            >
                                {p}
                            </button>
                        ))}
                    </div>
                </header>

                {/* The Scope Component wraps the UI that should inherit the theme */}
                <ProductThemeScope product={activeProduct} className="p-12 border border-border/50 rounded-3xl relative overflow-hidden min-h-[600px] transition-all duration-700">

                    <div className="grid md:grid-cols-2 gap-8 relative z-10">

                        {/* Left Column: Content */}
                        <div className="space-y-6">
                            <Badge variant="outline" className="border-primary/50 text-primary bg-primary/10 px-4 py-1 text-sm uppercase tracking-widest">
                                {activeProduct} Collection
                            </Badge>

                            <h2 className="text-5xl font-serif font-medium leading-tight">
                                {activeProduct === 'floristen' && 'Balance that brings relief.'}
                                {activeProduct === 'lyastin' && 'Regeneration with structure.'}
                                {activeProduct === 'silexil' && 'Strength and flexibility.'}
                                {activeProduct === 'retisin' && 'Energy that makes sense.'}
                            </h2>

                            <p className="text-lg text-muted-foreground leading-relaxed">
                                Notice how the primary color, ring focus, and ambient glow shift to match the product identity.
                                This creates a subconscious connection to the physical product.
                            </p>

                            <div className="flex gap-4 pt-4">
                                <Button size="lg" className="rounded-full px-8 shadow-lg shadow-primary/20">
                                    Main Action
                                </Button>
                                <Button variant="outline" size="lg" className="rounded-full px-8 border-primary/30 hover:bg-primary/5">
                                    Secondary
                                </Button>
                            </div>
                        </div>

                        {/* Right Column: UI Components */}
                        <div className="space-y-6">
                            <Card className="border-primary/20 bg-card/60 backdrop-blur-md shadow-2xl">
                                <CardHeader>
                                    <CardTitle>Interactive Elements</CardTitle>
                                    <CardDescription>All shadcn/ui components inherit the theme.</CardDescription>
                                </CardHeader>
                                <CardContent className="space-y-6">
                                    <div className="space-y-2">
                                        <label className="text-sm font-medium">Volume Control</label>
                                        <Slider
                                            value={sliderValue}
                                            onValueChange={setSliderValue}
                                            max={100}
                                            step={1}
                                            className="py-4"
                                        />
                                    </div>

                                    <Tabs defaultValue="account" className="w-full">
                                        <TabsList className="grid w-full grid-cols-2 bg-secondary/50">
                                            <TabsTrigger value="account">Details</TabsTrigger>
                                            <TabsTrigger value="password">Ingredients</TabsTrigger>
                                        </TabsList>
                                        <TabsContent value="account" className="p-4 bg-background/50 rounded-lg mt-2 border border-border/50">
                                            <div className="h-20 flex items-center justify-center text-sm text-muted-foreground">
                                                Content Panel Area
                                            </div>
                                        </TabsContent>
                                        <TabsContent value="password" className="p-4 bg-background/50 rounded-lg mt-2 border border-border/50">
                                            <div className="h-20 flex items-center justify-center text-sm text-muted-foreground">
                                                Ingredients list...
                                            </div>
                                        </TabsContent>
                                    </Tabs>
                                </CardContent>
                                <CardFooter className="justify-between border-t border-border/40 pt-6">
                                    <div className="text-xs text-muted-foreground">Product ID: #88392</div>
                                    <Badge className="bg-primary hover:bg-primary/90">In Stock</Badge>
                                </CardFooter>
                            </Card>
                        </div>

                    </div>
                </ProductThemeScope>

            </div>
        </div>
    );
}
