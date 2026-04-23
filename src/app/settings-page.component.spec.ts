import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { AuthService } from './auth.service';
import { LoginTimeoutOption } from './crypto.utils';
import { SettingsPageComponent } from './settings-page.component';

describe('SettingsPageComponent', () => {
  it('renders the login timeout settings', async () => {
    const auth = {
      loginTimeout: signal<LoginTimeoutOption>('1-hour'),
      setLoginTimeout: jasmine
        .createSpy('setLoginTimeout')
        .and.callFake(async (timeout: LoginTimeoutOption) => {
          auth.loginTimeout.set(timeout);
        }),
    };

    await TestBed.configureTestingModule({
      imports: [SettingsPageComponent],
      providers: [{ provide: AuthService, useValue: auth }],
    }).compileComponents();

    const fixture = TestBed.createComponent(SettingsPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const select = fixture.nativeElement.querySelector('#login-timeout') as HTMLSelectElement;
    expect(fixture.nativeElement.textContent).toContain('Settings');
    expect(fixture.nativeElement.textContent).toContain('Login');
    expect(select.value).toBe('1-hour');
  });

  it('updates the login timeout through the auth service', async () => {
    const auth = {
      loginTimeout: signal<LoginTimeoutOption>('1-hour'),
      setLoginTimeout: jasmine
        .createSpy('setLoginTimeout')
        .and.callFake(async (timeout: LoginTimeoutOption) => {
          auth.loginTimeout.set(timeout);
        }),
    };

    await TestBed.configureTestingModule({
      imports: [SettingsPageComponent],
      providers: [{ provide: AuthService, useValue: auth }],
    }).compileComponents();

    const fixture = TestBed.createComponent(SettingsPageComponent);
    fixture.detectChanges();

    const component = fixture.componentInstance;
    await component.updateLoginTimeout('never');

    expect(auth.setLoginTimeout).toHaveBeenCalledWith('never');
  });
});
