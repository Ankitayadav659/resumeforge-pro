/* ResumeForge Pro — data model, modes, samples */
window.RC = window.RC || {};
(function (RC) {
  'use strict';

  RC.uid = () => Math.random().toString(36).slice(2, 10);
  RC.esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  RC.SECTIONS = ['summary', 'experience', 'education', 'projects', 'skills', 'certifications', 'achievements', 'languages'];

  RC.DEFAULT_TITLES = {
    summary: 'Summary', experience: 'Experience', education: 'Education', projects: 'Projects',
    skills: 'Skills', certifications: 'Certifications', achievements: 'Achievements', languages: 'Languages'
  };

  RC.MODES = {
    fresher: {
      label: 'Fresher / Student',
      blurb: 'College students & graduates with 0–2 years. Education, projects and internships lead.',
      order: ['summary', 'education', 'skills', 'projects', 'experience', 'certifications', 'achievements', 'languages'],
      titles: { summary: 'Profile', experience: 'Internships & Experience', skills: 'Technical Skills', achievements: 'Achievements & Leadership' }
    },
    experienced: {
      label: 'Experienced Professional',
      blurb: '2–15 years. Impact-driven experience section leads, education moves down.',
      order: ['summary', 'experience', 'skills', 'projects', 'education', 'certifications', 'achievements', 'languages'],
      titles: { summary: 'Professional Summary', projects: 'Key Projects', achievements: 'Awards & Recognition' }
    },
    executive: {
      label: 'Senior / Executive',
      blurb: 'Directors, VPs, CXOs. Career highlights, scope (team, P&L, revenue) and strategy first.',
      order: ['summary', 'achievements', 'experience', 'skills', 'education', 'certifications', 'languages', 'projects'],
      titles: {
        summary: 'Executive Profile', achievements: 'Career Highlights', experience: 'Leadership Experience',
        skills: 'Core Competencies', projects: 'Strategic Initiatives', certifications: 'Certifications & Affiliations'
      }
    }
  };

  RC.TEMPLATES = {
    classic: { label: 'Classic', note: 'Centered, timeless. Safe for banks, consulting, govt.' },
    modern: { label: 'Modern', note: 'Clean sans-serif. Tech, product & startups.' },
    executive: { label: 'Executive', note: 'Bold header band. Senior leadership.' },
    compact: { label: 'Compact', note: 'Side headings, fits more on one page.' }
  };

  RC.FONTS = {
    sans: { label: 'Calibri / Sans', css: "Calibri, Carlito, 'Segoe UI', Arial, sans-serif" },
    helvetica: { label: 'Helvetica', css: "'Helvetica Neue', Helvetica, Arial, sans-serif" },
    serif: { label: 'Georgia / Serif', css: "Georgia, Cambria, 'Times New Roman', serif" },
    garamond: { label: 'Garamond', css: "Garamond, 'EB Garamond', 'Times New Roman', serif" }
  };

  RC.ACCENTS = ['#1f3a5f', '#2b2b2b', '#0f5e64', '#7a1f2b', '#1e5631', '#1d4ed8', '#5b3a8c'];

  RC.TARGETS = {
    general: { label: 'General Corporate', template: 'classic' },
    tech: { label: 'Tech / Product (FAANG-style)', template: 'modern' },
    consulting: { label: 'Consulting / Big 4', template: 'classic' },
    finance: { label: 'Banking & Finance', template: 'classic' }
  };

  RC.make = {
    experience: () => ({ id: RC.uid(), role: '', company: '', location: '', start: '', end: '', current: false, bullets: '' }),
    education: () => ({ id: RC.uid(), degree: '', institution: '', location: '', start: '', end: '', score: '', details: '' }),
    projects: () => ({ id: RC.uid(), name: '', tech: '', link: '', date: '', bullets: '' }),
    skills: () => ({ id: RC.uid(), category: '', items: '' }),
    certifications: () => ({ id: RC.uid(), name: '', issuer: '', year: '' }),
    achievements: () => ({ id: RC.uid(), text: '' })
  };

  RC.blank = function (mode) {
    mode = RC.MODES[mode] ? mode : 'experienced';
    return {
      id: RC.uid(),
      name: 'My Resume',
      mode,
      template: mode === 'executive' ? 'executive' : 'classic',
      accent: '#1f3a5f',
      font: mode === 'executive' ? 'garamond' : 'sans',
      fontSize: 10.5,
      target: 'general',
      order: RC.MODES[mode].order.slice(),
      hidden: [],
      personal: { fullName: '', title: '', email: '', phone: '', location: '', linkedin: '', github: '', website: '' },
      summary: '',
      experience: [RC.make.experience()],
      education: [RC.make.education()],
      projects: mode === 'fresher' ? [RC.make.projects()] : [],
      skills: [RC.make.skills()],
      certifications: [],
      achievements: [],
      languages: '',
      jd: '',
      updatedAt: Date.now()
    };
  };

  /* Ensures older/imported data has every field the app expects */
  RC.normalize = function (r) {
    const base = RC.blank(r && r.mode);
    const out = Object.assign(base, r || {});
    out.personal = Object.assign(RC.blank().personal, (r && r.personal) || {});
    Object.keys(RC.make).forEach((k) => {
      out[k] = Array.isArray(out[k]) ? out[k].map((x) => Object.assign(RC.make[k](), x, { id: (x && x.id) || RC.uid() })) : [];
    });
    if (!Array.isArray(out.order)) out.order = RC.MODES[out.mode].order.slice();
    RC.SECTIONS.forEach((s) => { if (!out.order.includes(s)) out.order.push(s); });
    if (!Array.isArray(out.hidden)) out.hidden = [];
    if (!RC.TEMPLATES[out.template]) out.template = 'classic';
    if (!RC.FONTS[out.font]) out.font = 'sans';
    if (!RC.TARGETS[out.target]) out.target = 'general';
    out.fontSize = Number(out.fontSize) || 10.5;
    return out;
  };

  const SAMPLES = {
    fresher: () => ({
      name: 'Sample — Fresher (Software Engineer)',
      target: 'tech',
      template: 'modern',
      personal: {
        fullName: 'Aarav Sharma', title: 'Software Engineer (Graduate)', email: 'aarav.sharma@example.com',
        phone: '+91 98765 43210', location: 'Bengaluru, India', linkedin: 'linkedin.com/in/aaravsharma',
        github: 'github.com/aaravsharma', website: ''
      },
      summary: 'Computer Science graduate (CGPA 8.7/10) with hands-on experience building full-stack web applications in React, Node.js and Python. Built 2 production-style projects used by 1,200+ students and completed a backend internship at a fintech startup. Eager to build scalable, user-focused products as a Software Engineer.',
      education: [
        { degree: 'B.Tech in Computer Science & Engineering', institution: 'Vellore Institute of Technology', location: 'Vellore', start: '2021', end: '2025', score: 'CGPA 8.7/10', details: 'Relevant coursework: Data Structures & Algorithms, DBMS, Operating Systems, Computer Networks' },
        { degree: 'Class XII (CBSE)', institution: 'Delhi Public School', location: 'New Delhi', start: '', end: '2021', score: '92.4%', details: '' }
      ],
      experience: [
        {
          role: 'Software Engineering Intern', company: 'PaySphere Technologies', location: 'Bengaluru', start: 'May 2024', end: 'Jul 2024', current: false,
          bullets: 'Built 6 REST APIs in Node.js and PostgreSQL for merchant onboarding, reducing manual verification time by 40%\nWrote 85+ unit tests with Jest, raising service test coverage from 52% to 81%\nOptimized 3 slow SQL queries with indexing, cutting average API response time from 900 ms to 220 ms'
        }
      ],
      projects: [
        { name: 'CampusConnect — Student Marketplace', tech: 'React, Node.js, MongoDB, Socket.io', link: 'github.com/aaravsharma/campusconnect', date: '2024', bullets: 'Developed a full-stack marketplace adopted by 1,200+ students across 4 hostels in its first semester\nImplemented JWT authentication and real-time chat with Socket.io, handling 300+ messages per day' },
        { name: 'ExpenseIQ — ML Expense Classifier', tech: 'Python, scikit-learn, Flask', link: 'github.com/aaravsharma/expenseiq', date: '2023', bullets: 'Trained a text-classification model on 15,000 transactions, achieving 91% accuracy in categorising expenses\nDeployed the model as a Flask API with a 120 ms median response time' }
      ],
      skills: [
        { category: 'Languages', items: 'Java, Python, JavaScript, SQL' },
        { category: 'Frameworks', items: 'React, Node.js, Express, Flask' },
        { category: 'Tools & Cloud', items: 'Git, Docker, PostgreSQL, MongoDB, AWS (EC2, S3)' },
        { category: 'Fundamentals', items: 'DSA, OOP, DBMS, Operating Systems' }
      ],
      certifications: [{ name: 'AWS Certified Cloud Practitioner', issuer: 'Amazon Web Services', year: '2024' }],
      achievements: [
        { text: 'Solved 450+ problems on LeetCode; contest rating 1,780 (top 8% globally)' },
        { text: 'Winner, college round of Smart India Hackathon 2023 among 120 teams' },
        { text: 'Technical Lead, Google Developer Student Club — organized 5 workshops for 400+ students' }
      ],
      languages: 'English (Fluent), Hindi (Native)'
    }),
    experienced: () => ({
      name: 'Sample — Senior Product Manager',
      target: 'tech',
      personal: {
        fullName: 'Priya Mehta', title: 'Senior Product Manager — Fintech & Payments', email: 'priya.mehta@example.com',
        phone: '+91 98200 12345', location: 'Mumbai, India', linkedin: 'linkedin.com/in/priyamehta', github: '', website: ''
      },
      summary: 'Senior Product Manager with 8+ years of experience building B2C fintech and e-commerce products used by 20M+ customers. Led cross-functional teams of 25+ engineers, designers and analysts to launch products generating ₹180 Cr in annual revenue. Known for data-driven roadmaps, rapid experimentation and turning customer insight into measurable business outcomes.',
      experience: [
        {
          role: 'Senior Product Manager', company: 'Finova Digital', location: 'Mumbai', start: 'Apr 2021', end: '', current: true,
          bullets: 'Lead the end-to-end roadmap for a UPI payments app with 12M monthly active users and a team of 18 engineers\nLaunched one-tap autopay, growing recurring payment volume 64% YoY and adding ₹45 Cr in annual revenue\nReduced checkout drop-off from 23% to 14% by running 30+ A/B tests on the payment flow\nPartnered with risk and compliance to ship RBI-mandated card tokenization 3 weeks ahead of deadline'
        },
        {
          role: 'Product Manager', company: 'ShopKart', location: 'Bengaluru', start: 'Jun 2018', end: 'Mar 2021', current: false,
          bullets: 'Owned search and discovery for 8M+ products, improving search-to-purchase conversion by 18%\nIntroduced personalised recommendations that increased average order value by 11% across 5M users\nBuilt a self-serve analytics dashboard adopted by 40+ category managers, saving 120 hours of reporting per month'
        },
        {
          role: 'Business Analyst', company: 'Northbridge Consulting', location: 'Mumbai', start: 'Jul 2016', end: 'May 2018', current: false,
          bullets: 'Analyzed operations data for 6 retail clients, identifying ₹12 Cr in cost-saving opportunities\nBuilt forecasting models in Excel and SQL that improved inventory planning accuracy by 22%'
        }
      ],
      education: [
        { degree: 'MBA — Marketing & Strategy', institution: 'Indian Institute of Management, Lucknow', location: '', start: '2014', end: '2016', score: '', details: '' },
        { degree: 'B.E. in Computer Engineering', institution: 'University of Mumbai', location: '', start: '2010', end: '2014', score: '', details: '' }
      ],
      projects: [],
      skills: [
        { category: 'Product', items: 'Roadmapping, A/B Testing, User Research, PRDs, Go-to-Market, Pricing' },
        { category: 'Analytics', items: 'SQL, Amplitude, Mixpanel, Tableau, Excel' },
        { category: 'Domain', items: 'UPI, Payments, E-commerce, Fintech Compliance' },
        { category: 'Tools', items: 'Jira, Figma, Confluence' }
      ],
      certifications: [{ name: 'Certified Scrum Product Owner (CSPO)', issuer: 'Scrum Alliance', year: '2020' }],
      achievements: [{ text: 'Product Leader of the Year 2023 at Finova Digital, selected from 60+ product managers' }],
      languages: 'English, Hindi, Marathi'
    }),
    executive: () => ({
      name: 'Sample — VP Engineering',
      target: 'tech',
      personal: {
        fullName: 'Rajesh Iyer', title: 'Vice President of Engineering | Fintech & SaaS Platforms', email: 'rajesh.iyer@example.com',
        phone: '+91 99000 54321', location: 'Bengaluru, India', linkedin: 'linkedin.com/in/rajeshiyer', github: '', website: ''
      },
      summary: 'Technology executive with 18+ years of experience scaling engineering organizations and platforms in SaaS and fintech. Built and led teams of 400+ engineers across India, Singapore and the US, delivering platforms that process $2B+ in annual transactions. Board-facing leader with a record of driving cloud transformation, cutting infrastructure costs by 35% and enabling 3x revenue growth.',
      achievements: [
        { text: 'Scaled engineering from 60 to 420 people across 3 countries while increasing release frequency 10x' },
        { text: 'Led a $40M cloud migration to AWS, reducing infrastructure spend by 35% ($6M annually)' },
        { text: 'Drove technology due diligence and integration for 2 acquisitions totaling $120M' }
      ],
      experience: [
        {
          role: 'Vice President of Engineering', company: 'HelixPay', location: 'Bengaluru', start: 'Jan 2019', end: '', current: true,
          bullets: 'Lead a 420-person engineering organization across platform, payments, data and security with a $28M annual budget\nArchitect the multi-region payments platform processing $2B+ annually at 99.99% uptime\nPartner with the CEO and board on technology strategy, contributing to a $150M Series D raise'
        },
        {
          role: 'Director of Engineering', company: 'CloudNine Software', location: 'Singapore', start: 'Mar 2013', end: 'Dec 2018', current: false,
          bullets: 'Built the APAC engineering hub from 15 to 140 engineers, cutting delivery costs by 28%\nDelivered the flagship SaaS analytics product, growing ARR from $8M to $32M in 4 years'
        },
        {
          role: 'Senior Engineering Manager', company: 'Vertex Systems', location: 'Pune', start: 'Jul 2007', end: 'Feb 2013', current: false,
          bullets: 'Managed 6 teams (55 engineers) delivering core banking software for 12 enterprise clients'
        }
      ],
      education: [
        { degree: 'M.S. in Computer Science', institution: 'Indian Institute of Science', location: 'Bengaluru', start: '2005', end: '2007', score: '', details: '' },
        { degree: 'B.Tech in Computer Science', institution: 'National Institute of Technology', location: 'Tiruchirappalli', start: '2001', end: '2005', score: '', details: '' }
      ],
      projects: [],
      skills: [
        { category: 'Leadership', items: 'Org Design, Executive Hiring, Board Communication, P&L Ownership, M&A Integration' },
        { category: 'Technology', items: 'Cloud Architecture (AWS, GCP), Payments, Distributed Systems, Data Platforms, Security & Compliance (PCI-DSS, SOC 2)' }
      ],
      certifications: [{ name: 'AWS Certified Solutions Architect – Professional', issuer: 'Amazon Web Services', year: '2019' }],
      languages: 'English, Hindi, Tamil'
    })
  };

  RC.sample = function (mode) {
    const base = RC.blank(mode);
    const s = SAMPLES[mode] ? SAMPLES[mode]() : SAMPLES.experienced();
    const merged = Object.assign(base, s, { personal: Object.assign(base.personal, s.personal) });
    return RC.normalize(merged);
  };
})(window.RC);
