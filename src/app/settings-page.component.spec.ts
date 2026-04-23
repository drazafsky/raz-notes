import { TestBed } from '@angular/core/testing';

import { SettingsPageComponent } from './settings-page.component';

describe('SettingsPageComponent', () => {
  it('renders only the settings heading', async () => {
    await TestBed.configureTestingModule({
      imports: [SettingsPageComponent]
    }).compileComponents();

    const fixture = TestBed.createComponent(SettingsPageComponent);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent.trim()).toContain('Settings');
  });
});
