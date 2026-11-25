import { lazy, Suspense, useEffect } from "react";
import { Route, Switch, useLocation } from "wouter";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { queryClient } from "@/lib/api";
import { LanguageProvider } from "@/lib/i18n";
import { AuthProvider } from "@/hooks/useAuth";
import { CartProvider } from "@/context/CartContext";
import { LiveProvider } from "@/lib/live";
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
const Taxi = lazy(() => import("@/pages/customer/Taxi"));
const Envios = lazy(() => import("@/pages/customer/Envios"));
const RideShare = lazy(() => import("@/pages/customer/RideShare"));
// Motorista de táxi
const TaxiHome = lazy(() => import("@/pages/taxi/TaxiHome"));
const TaxiWallet = lazy(() => import("@/pages/taxi/TaxiHome").then((m) => ({ default: m.TaxiWalletPage })));
const AdminRides = lazy(() => import("@/pages/admin/AdminRides"));

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
const PartnerAds = lazy(() => import("@/pages/partner/PartnerAds"));
const PartnerPayouts = lazy(() => import("@/pages/partner/PartnerPayouts"));
const AdminAudit = lazy(() => import("@/pages/admin/AdminAudit"));
const AdminTeam = lazy(() => import("@/pages/admin/AdminTeam"));
const AdminFinance = lazy(() => import("@/pages/admin/AdminFinance"));
const AdminDispatch = lazy(() => import("@/pages/admin/AdminDispatch"));
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
        <Route path="/taxi" component={Taxi} />
        <Route path="/envios" component={Envios} />
        <Route path="/viagem/:token" component={RideShare} />
        <Route path="/taxista" component={TaxiHome} />
        <Route path="/taxista/carteira" component={TaxiWallet} />

        <Route path="/parceiro" component={PartnerOrders} />
        <Route path="/parceiro/menu" component={PartnerMenu} />
        <Route path="/parceiro/loja" component={PartnerStore} />
        <Route path="/parceiro/avaliacoes" component={PartnerReviews} />
        <Route path="/parceiro/estatisticas" component={PartnerStats} />
        <Route path="/parceiro/pagamentos" component={PartnerPayouts} />
        <Route path="/parceiro/publicidade" component={PartnerAds} />

        <Route path="/estafeta" component={DriverHome} />
        <Route path="/estafeta/historico" component={DriverHistory} />

        <Route path="/admin" component={AdminDashboard} />
        <Route path="/admin/encomendas" component={AdminOrders} />
        <Route path="/admin/despacho" component={AdminDispatch} />
        <Route path="/admin/viagens" component={AdminRides} />
        <Route path="/admin/financas" component={AdminFinance} />
        <Route path="/admin/equipa" component={AdminTeam} />
        <Route path="/admin/registo" component={AdminAudit} />
        <Route path="/admin/lojas" component={AdminStores} />
        <Route path="/admin/utilizadores" component={AdminUsers} />
        <Route path="/admin/promocoes" component={AdminPromos} />
        <Route path="/admin/publicidade" component={AdminBanners} />

        <Route component={NotFound} />
      </Switch>
    </Suspense>
  );
}

/** No endereço próprio da administração (ADMIN_HOST) só existe o portal admin e o login. */
function AdminHostRedirect() {
  const [path, navigate] = useLocation();
  const { data } = useQuery<{ adminHost: string | null }>({ queryKey: ["/api/meta"], staleTime: 300_000 });
  useEffect(() => {
    const host = data?.adminHost;
    if (host && window.location.hostname.toLowerCase() === host && !path.startsWith("/admin") && !path.startsWith("/entrar")) {
      navigate("/admin", { replace: true });
    }
  }, [data?.adminHost, path]);
  return null;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <LanguageProvider>
        <AuthProvider>
          <LiveProvider>
          <CartProvider>
            <TooltipProvider>
              <AdminHostRedirect />
              <Routes />
              <Toaster />
            </TooltipProvider>
          </CartProvider>
          </LiveProvider>
        </AuthProvider>
      </LanguageProvider>
    </QueryClientProvider>
  );
}
