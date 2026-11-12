import { Routes } from '@angular/router';
import { DashboardComponent } from './features/dashboard/dashboard.component';
import { HostnameComponent } from './features/hostname/hostname.component';
import { UsersComponent } from './features/users/users.component';
import { StorageComponent } from './features/storage/storage.component';
import { CleanupComponent } from './features/cleanup/cleanup.component';
import { RepairComponent } from './features/repair/repair.component';
import { EmailComponent } from './features/email/email.component';
import { ServiceOrderComponent } from './features/service-order/service-order.component';
import { AiAssistantComponent } from './features/ai-assistant/ai-assistant.component';
import { ToolkitComponent } from './features/toolkit/toolkit.component';

export const routes: Routes = [
  { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
  { path: 'dashboard', component: DashboardComponent },
  { path: 'ai-assistant', component: AiAssistantComponent },
  { path: 'toolkit', component: ToolkitComponent },
  { path: 'hostname', component: HostnameComponent },
  { path: 'users', component: UsersComponent },
  { path: 'storage', component: StorageComponent },
  { path: 'cleanup', component: CleanupComponent },
  { path: 'repair', component: RepairComponent },
  { path: 'email', component: EmailComponent },
  { path: 'service-order', component: ServiceOrderComponent },
  { path: '**', redirectTo: 'dashboard' }
];
