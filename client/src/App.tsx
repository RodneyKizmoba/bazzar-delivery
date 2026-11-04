import { lazy, Suspense } from "react";
import { Route, Switch } from "wouter";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { queryClient } from "@/lib/api";
import { LanguageProvider } from "@/lib/i18n";
import { AuthProvider } from "@/hooks/useAuth";
import { CartProvider } from "@/context/CartContext";
import { Loading } from "@/components/common";

// Cliente
const Home = lazy(() => import("@/pages/customer/Home"));
const Search = lazy(() => import("@/pages/customer/Search"));
const StorePage = lazy(() => import("@/pages/customer/Store"));
const Cart = lazy(() => import("@/pages/customer/Cart"));
const Checkout = lazy(() => import("@/pages/customer/Checkout"));
const Orders = lazy(() => import("@/pages/customer/Orders"));
const OrderDetail = lazy(() => import("@/pages/customer/OrderDetail"));
const GroupOrder = lazy(() => import("@/pages/customer/GroupOrder"));
const Plus = lazy(() => import("@/pages/customer/Plus"));
const Profile = lazy(() => import("@/pages/customer/Profile"));
const Addresses = lazy(() => import("@/pages/customer/Addresses"));
const Favorites = lazy(() => import("@/pages/customer/Favorites"));
const Rewards = lazy(() => import("@/pages/customer/Rewards"));
const Login = lazy(() => import("@/pages/customer/Login"));
const Register = lazy(() => import("@/pages/customer/Register"));
const Info = lazy(() => import("@/pages/info/Info"));

// Parceiro (loja)
const PartnerOrders = lazy(() => import("@/pages/partner/PartnerOrders"));
const PartnerMenu = lazy(() => import("@/pages/partner/PartnerMenu"));
const PartnerStore = lazy(() => import("@/pages/partner/PartnerStore"));
const PartnerReviews = lazy(() => import("@/pages/partner/PartnerReviews"));
const PartnerStats = lazy(() => import("@/pages/partner/PartnerStats"));

// Estafeta
const DriverHome = lazy(() => import("@/pages/driver/DriverHome"));
const DriverHistory = lazy(() => import("@/pages/driver/DriverHistory"));

// Admin
const AdminDashboard = lazy(() => import("@/pages/admin/AdminDashboard"));
const AdminOrders = lazy(() => import("@/pages/admin/AdminOrders"));
const AdminStores = lazy(() => import("@/pages/admin/AdminStores"));
const AdminUsers = lazy(() => import("@/pages/admin/AdminUsers"));
const AdminPromos = lazy(() => import("@/pages/admin/AdminPromos"));
const AdminBanners = lazy(() => import("@/pages/admin/AdminBanners"));

const NotFound = lazy(() => import("@/pages/info/NotFound"));

function Routes() {
  return (
    <Suspense fallback={<Loading />}>
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/pesquisa" component={Search} />
        <Route path="/loja/:id" component={StorePage} />
        <Route path="/carrinho" component={Cart} />
        <Route path="/checkout" component={Checkout} />
        <Route path="/encomendas" component={Orders} />
        <Route path="/encomendas/:id" component={OrderDetail} />
        <Route path="/grupo/:token" component={GroupOrder} />
        <Route path="/plus" component={Plus} />
        <Route path="/perfil" component={Profile} />
        <Route path="/perfil/moradas" component={Addresses} />
        <Route path="/perfil/pontos" component={Rewards} />
        <Route path="/favoritos" component={Favorites} />
        <Route path="/entrar" component={Login} />
        <Route path="/registar" component={Register} />
        <Route path="/info/:page" component={Info} />

        <Route path="/parceiro" component={PartnerOrders} />
        <Route path="/parceiro/menu" component={PartnerMenu} />
        <Route path="/parceiro/loja" component={PartnerStore} />
        <Route path="/parceiro/avaliacoes" component={PartnerReviews} />
        <Route path="/parceiro/estatisticas" component={PartnerStats} />

        <Route path="/estafeta" component={DriverHome} />
        <Route path="/estafeta/historico" component={DriverHistory} />

        <Route path="/admin" component={AdminDashboard} />
        <Route path="/admin/encomendas" component={AdminOrders} />
        <Route path="/admin/lojas" component={AdminStores} />
        <Route path="/admin/utilizadores" component={AdminUsers} />
        <Route path="/admin/promocoes" component={AdminPromos} />
        <Route path="/admin/publicidade" component={AdminBanners} />

        <Route component={NotFound} />
      </Switch>
    </Suspense>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <LanguageProvider>
        <AuthProvider>
          <CartProvider>
            <TooltipProvider>
              <Routes />
              <Toaster />
            </TooltipProvider>
          </CartProvider>
        </AuthProvider>
      </LanguageProvider>
    </QueryClientProvider>
  );
}
